import { readFileSync } from "node:fs";
import { simulate } from "@mekasim/core";
import { buildScene, type Scene } from "@mekasim/ui";
import { describe, expect, it } from "vitest";
import {
  beltRuns,
  drawnJointNear,
  nearestStep,
  pick,
  pinNear,
  pointsNear,
  toLocal,
  toWorld,
  worldPoints,
} from "./pick.ts";

function example(name: string): Scene {
  const url = new URL(`../../../../examples/${name}.mekasim.yaml`, import.meta.url);
  const scene = buildScene(simulate(readFileSync(url, "utf8")));
  if (!scene) throw new Error(`${name} cannot be drawn`);
  return scene;
}

const shaker = example("shaker");
const TOL = 0.005;

describe("worldPoints", () => {
  it("lists ground and body points where they are drawn", () => {
    const points = worldPoints(shaker, 0);
    const at = (ref: string) => points.find((p) => p.ref === ref);
    expect(at("ground.R")).toMatchObject({ x: 0.5, y: 0, index: -1 });
    // The model is written as drawn, so at step 0 every point is where the text puts it.
    expect(at("upper_deck.B")?.x).toBeCloseTo(1.3, 9);
    expect(at("upper_deck.B")?.y).toBeCloseTo(0.12, 9);
  });

  it("round-trips between world and body frames", () => {
    const [x, y] = toWorld(shaker, 2, 40, 0.5, 0.12);
    const [u, v] = toLocal(shaker, 2, 40, x, y);
    expect(u).toBeCloseTo(0.5, 12);
    expect(v).toBeCloseTo(0.12, 12);
  });
});

describe("pick", () => {
  it("prefers a joint to the points and bodies under it", () => {
    expect(pick(shaker, 0, 0.5, 0.12, TOL)).toEqual({ kind: "joint", id: "upper_front" });
  });

  it("finds a body by its plate", () => {
    expect(pick(shaker, 0, 0.9, 0.12, TOL)).toEqual({ kind: "body", id: "upper_deck" });
    expect(pick(shaker, 0, 0.9, -0.12, TOL)).toEqual({ kind: "body", id: "lower_deck" });
  });

  it("takes the front body where two overlap", () => {
    // The pitman (layer 1) crosses in front of the rocker (layer 0) near its drive point.
    expect(pick(shaker, 0, 0.497, 0.03, TOL)).toEqual({ kind: "body", id: "rocker" });
    expect(pick(shaker, 0, 0.48, 0.059, TOL)).toEqual({ kind: "body", id: "pitman" });
  });

  it("finds nothing on empty paper", () => {
    expect(pick(shaker, 0, 0.9, 0.5, TOL)).toBeUndefined();
  });

  it("finds a point that carries no joint", () => {
    const scene = example("four-bar");
    const p = worldPoints(scene, 0).find((point) => point.ref === "coupler.P");
    expect(pick(scene, 0, p?.x ?? 0, p?.y ?? 0, 0.002)).toEqual({
      kind: "point",
      ref: "coupler.P",
    });
  });
});

describe("pointsNear and pinNear", () => {
  it("returns the points that share a place, for pinning", () => {
    const near = pointsNear(worldPoints(shaker, 0), 1.3, 0, TOL).map((p) => p.ref);
    expect(near.sort()).toEqual(["ground.G", "lower_arm.G", "upper_arm.G"]);
  });

  it("finds the pin at a place", () => {
    expect(pinNear(shaker, 0, 0, 0, TOL)?.id).toBe("shaft");
    expect(pinNear(shaker, 0, 0.2, 0.2, TOL)).toBeUndefined();
  });
});

describe("nearestStep", () => {
  const xs = Float64Array.from({ length: 360 }, (_, k) => Math.cos((k * Math.PI) / 180));
  const ys = Float64Array.from({ length: 360 }, (_, k) => Math.sin((k * Math.PI) / 180));

  it("finds the sample nearest the cursor", () => {
    expect(nearestStep(xs, ys, 2 * Math.cos(0.5), 2 * Math.sin(0.5), 20, true)).toBe(29);
  });

  it("wraps around the end of a repeating cycle", () => {
    expect(nearestStep(xs, ys, Math.cos(-0.1), Math.sin(-0.1), 5, true)).toBe(354);
    expect(nearestStep(xs, ys, Math.cos(-0.1), Math.sin(-0.1), 5, false)).toBe(0);
  });

  it("stays near the current step rather than jumping across the cycle", () => {
    // The cursor is nearest sample 180, but that is half a cycle away.
    expect(nearestStep(xs, ys, -1, 0, 10, true)).toBe(70);
  });
});

describe("gears, belts, cams and ties", () => {
  it("finds a gear by the rim of either wheel", () => {
    const geared = example("geared-five-bar");
    // The pinion is at the origin with a 20 mm radius; the wheel at 60 mm with 40 mm.
    expect(drawnJointNear(geared, 0, 0, -0.02, 0.002)).toBe("mesh");
    expect(drawnJointNear(geared, 0, 0.06, -0.04, 0.002)).toBe("mesh");
    expect(drawnJointNear(geared, 0, 0.06, -0.02, 0.002)).toBeUndefined();
    expect(pick(geared, 0, 0, -0.02, 0.002)).toEqual({ kind: "joint", id: "mesh" });
  });

  it("finds a cam by its edge and by the follower's roller", () => {
    const cam = example("cam-follower");
    // The roller is 8 mm round the follower point, which starts above the cam centre.
    const follower = worldPoints(cam, 0).find((p) => p.ref === "lifter.P");
    expect(drawnJointNear(cam, 0, 0.005, (follower?.y ?? 0) + 0.004, 0.001)).toBe("contact");
    // Straight down from the centre the cam is at its base: 30 mm less the roller.
    expect(drawnJointNear(cam, 0, 0, -0.022, 0.001)).toBe("contact");
    expect(drawnJointNear(cam, 0, 0.1, 0.1, 0.001)).toBeUndefined();
  });

  it("gives the two runs of a belt as the lines touching both wheels", () => {
    const [upper, lower] = beltRuns([0, 0], 0.03, [0.2, 0], 0.01);
    // Each end is on its wheel, and the run is square to the radius there.
    for (const [from, to] of [upper, lower] as [[number, number], [number, number]][]) {
      expect(Math.hypot(...from)).toBeCloseTo(0.03, 12);
      expect(Math.hypot(to[0] - 0.2, to[1])).toBeCloseTo(0.01, 12);
      expect(from[0] * (to[0] - from[0]) + from[1] * (to[1] - from[1])).toBeCloseTo(0, 12);
    }
    expect(upper?.[0][1]).toBeGreaterThan(0);
    expect(lower?.[0][1]).toBeLessThan(0);
  });
});
