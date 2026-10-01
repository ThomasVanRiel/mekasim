import { readFileSync } from "node:fs";
import { simulate } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { buildScene, poseAt, type Scene } from "./scene.ts";

function example(name: string): Scene {
  const url = new URL(`../../../../examples/${name}.mekasim.yaml`, import.meta.url);
  const scene = buildScene(simulate(readFileSync(url, "utf8")));
  if (!scene) throw new Error(`${name} cannot be drawn`);
  return scene;
}

describe("buildScene", () => {
  const shaker = example("shaker");

  it("covers everything the mechanism reaches", () => {
    // Ground runs from the shaft at x = 0 to the rear arms at 1300 mm; the eccentric swings behind 0.
    expect(shaker.bounds.minX).toBeCloseTo(-0.015, 6);
    expect(shaker.bounds.maxX).toBeGreaterThan(1.3);
    expect(shaker.bounds.maxX).toBeLessThan(1.34);
  });

  it("draws one plate per moving body and one pin per joint", () => {
    expect(shaker.bodies.map((b) => b.id)).toEqual([
      "eccentric",
      "pitman",
      "rocker",
      "upper_deck",
      "lower_deck",
      "upper_arm",
      "lower_arm",
    ]);
    expect(shaker.pins).toHaveLength(10);
    expect(shaker.pins.filter((p) => p.driven).map((p) => p.id)).toEqual(["shaft"]);
  });

  it("marks each fixed pivot once", () => {
    // Shaft, rocker pivot, and the one ground point the two rear arms share.
    expect(shaker.supports).toHaveLength(3);
  });

  it("names pinned points once, keeping the ground's name", () => {
    const points = shaker.labels.filter((l) => !l.body);
    const at = (carrier: number) => points.filter((l) => l.carrier === carrier).map((l) => l.text);
    expect(at(-1)).toEqual(["O", "R", "G"]);
    // The eccentric's O is pinned to ground and its A carries the crankpin's name.
    expect(at(0)).toEqual(["A"]);
    // The pitman's A is the eccentric's A; its D is named.
    expect(at(1)).toEqual(["D"]);
    expect(shaker.labels.filter((l) => l.body)).toHaveLength(7);
  });

  it("recognises a repeating cycle and closes its traces", () => {
    expect(shaker.periodic).toBe(true);
    const trace = shaker.traces[0];
    expect(trace?.points).toHaveLength(361);
    expect(trace?.points.at(-1)).toEqual(trace?.points[0]);
  });

  it("uses a round grid spacing in document units", () => {
    expect(shaker.gridStep).toBeCloseTo(0.1, 12);
    expect(example("four-bar").gridStep).toBeCloseTo(0.02, 12);
  });

  it("draws the travel of a pin-slot joint as an axis", () => {
    const { axes } = example("slider-crank");
    expect(axes).toHaveLength(1);
    // The rod end runs between 405 and 435 mm along the ground axis.
    expect(axes[0]?.to[0]).toBeGreaterThan(0.435);
    expect(axes[0]?.from[1]).toBeCloseTo(0, 12);
  });
});

describe("poseAt", () => {
  const scene = example("four-bar");
  const pose: [number, number, number] = [0, 0, 0];

  it("interpolates between samples", () => {
    poseAt(scene, 0, 90.5, pose);
    expect(pose[2]).toBeCloseTo((90.5 * Math.PI) / 180, 9);
  });

  it("carries the crank smoothly from the last sample back to the first", () => {
    poseAt(scene, 0, 359.5, pose);
    expect(pose[2]).toBeCloseTo((359.5 * Math.PI) / 180, 9);
  });
});
