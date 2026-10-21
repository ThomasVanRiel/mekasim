import { readFileSync } from "node:fs";
import { placeInSpace, simulate } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { buildScene, type Scene } from "./scene.ts";
import { spaceJointAt, spacePoseAt } from "./space.ts";

function example(name: string): { scene: Scene; simulation: ReturnType<typeof simulate> } {
  const url = new URL(`../../../examples/spatial/${name}.mekasim.yaml`, import.meta.url);
  const simulation = simulate(readFileSync(url, "utf8"));
  const scene = buildScene(simulation);
  if (!scene) throw new Error(`${name} cannot be drawn`);
  return { scene, simulation };
}

/** A point of a body's frame moved by a pose `[x, y, z, qx, qy, qz, qw]`. */
function moved(pose: Float64Array, [x, y, z]: number[]): number[] {
  const [px, py, pz, qx, qy, qz, qw] = pose as unknown as number[];
  // v' = v + 2 w (q × v) + 2 q × (q × v), with q the vector part.
  const q = [qx, qy, qz] as number[];
  const v = [x, y, z] as number[];
  const cross = (a: number[], b: number[]): number[] => [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
  const t = cross(q, v).map((value) => 2 * value);
  const u = cross(q, t);
  return [0, 1, 2].map(
    (i) =>
      ([px, py, pz][i] as number) +
      (v[i] as number) +
      (qw as number) * (t[i] as number) +
      (u[i] as number),
  );
}

describe("what moves in space", () => {
  const { scene, simulation } = example("swash-plate");
  const space = scene.space;

  it("draws every body in space and every joint between them", () => {
    expect(space?.bodies.map((body) => body.id)).toEqual([
      "rotor",
      "swash",
      "blade_1",
      "blade_2",
      "drive_link",
      "pitch_1",
      "pitch_2",
    ]);
    expect(space?.joints).toHaveLength(10);
    expect(space?.joints.find((joint) => joint.id === "mast")?.driven).toBe(true);
    // A blade has rods from its hinge to its horn and its tip.
    expect(space?.bodies.find((body) => body.id === "blade_1")?.rods).toHaveLength(2);
  });

  it("puts each body's points where the solver puts them", () => {
    const { compiled, cycle } = simulation;
    if (!space || !compiled || !cycle) throw new Error("does not solve");
    const pose = new Float64Array(7);
    for (const k of [0, 77, 200, 359]) {
      const q = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
      for (const body of space.bodies) {
        spacePoseAt(body, k, scene.periodic, pose);
        const at = compiled.spatial.get(body.id)?.at as number;
        for (const { s } of body.points) {
          const drawn = moved(pose, s);
          const solved = placeInSpace(q, { at, s });
          for (let i = 0; i < 3; i++) expect(drawn[i]).toBeCloseTo(solved[i] as number, 9);
        }
      }
    }
  });

  it("puts each joint where its two points meet", () => {
    if (!space) throw new Error("nothing in space");
    const at = new Float64Array(3);
    const axis = new Float64Array(3);
    const mast = space.joints.find((joint) => joint.id === "mast");
    if (!mast) throw new Error("no mast");
    spaceJointAt(mast, 100.5, scene.periodic, at, axis);
    expect([...at].map((v) => Number(v.toFixed(12)))).toEqual([0, 0, 0]);
    expect(axis[2]).toBeCloseTo(1, 12);
  });

  it("loops, though a turn of the rotor brings its Euler parameters back negated", () => {
    expect(scene.periodic).toBe(true);
    expect(scene.depth).toBeGreaterThan(0.2);
  });

  it("draws the rocker of the four-bar on two planes on its plane", () => {
    const planes = example("rssr-planes").scene;
    expect(planes.space?.bodies.map((body) => body.id)).toEqual(["coupler", "rocker"]);
    // The crank stays on the sheet, drawn as a plate.
    expect(planes.bodies.map((body) => body.id)).toEqual(["crank"]);
  });
});
