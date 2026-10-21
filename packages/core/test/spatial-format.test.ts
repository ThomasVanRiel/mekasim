import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../src/schema/document.ts";
import { load } from "../src/schema/load.ts";
import { simulate } from "../src/simulate.ts";
import { maxAbs } from "../src/solver/linalg.ts";
import { residual } from "../src/solver/solve.ts";
import { placePoint, SPATIAL_SIZE } from "../src/solver/spatial.ts";

const RSSR = readFileSync(
  new URL("../../../examples/spatial/rssr.mekasim.yaml", import.meta.url),
  "utf8",
);

function messages(text: string, severity = "error"): string[] {
  return simulate(text)
    .diagnostics.filter((d) => d.severity === severity)
    .map((d) => d.message);
}

describe("the RSSR example", () => {
  const simulation = simulate(RSSR);
  const { compiled, cycle } = simulation;

  it("solves through a whole turn of its crank, with one degree of freedom", () => {
    expect(simulation.diagnostics.map((d) => d.message)).toEqual([
      '"coupler" can turn without moving any of its points, so that turning is not counted as a degree of freedom',
    ]);
    expect(cycle?.count).toBe(360);
    expect(simulation.mobility).toMatchObject({
      coordinates: 3 * SPATIAL_SIZE,
      mobility: 1,
      free: 0,
      idle: 1,
      idleBodies: ["coupler"],
    });
  });

  it("keeps the bodies in space apart from those in the plane", () => {
    expect([...(compiled?.bodies.keys() ?? [])]).toEqual(["ground"]);
    expect([...(compiled?.spatial.values() ?? [])].map(({ id, at }) => [id, at])).toEqual([
      ["crank", 0],
      ["coupler", 7],
      ["rocker", 14],
    ]);
    expect(compiled?.model.bodies).toEqual([]);
  });

  it("keeps the rod's length and swings the rocker about its own axis", () => {
    if (!compiled || !cycle) throw new Error("does not solve");
    const { width } = cycle;
    const rocker = compiled.spatial.get("rocker");
    const crank = compiled.spatial.get("crank");
    if (!rocker || !crank) throw new Error("missing bodies");
    const tip = { at: rocker.at, s: rocker.points.get("B") as [number, number, number] };
    const end = { at: crank.at, s: crank.points.get("A") as [number, number, number] };
    let lowest = Infinity;
    let highest = -Infinity;
    for (let k = 0; k < cycle.count; k++) {
      const q = cycle.q.subarray(k * width, (k + 1) * width);
      expect(maxAbs(residual(compiled.model, q, cycle.t[k] as number))).toBeLessThan(1e-10);
      const [ax, ay, az] = placePoint(q, end);
      const [bx, by, bz] = placePoint(q, tip);
      expect(Math.hypot(bx - ax, by - ay, bz - az)).toBeCloseTo(0.095, 10);
      // The crank's end stays on its circle, and the rocker's in its plane, x = 50 mm.
      expect(Math.hypot(ax, ay)).toBeCloseTo(0.02, 10);
      expect(az).toBeCloseTo(0, 10);
      expect(bx).toBeCloseTo(0.05, 10);
      const swing = Math.atan2(bz - 0.04, by - 0.06);
      lowest = Math.min(lowest, swing);
      highest = Math.max(highest, swing);
    }
    // It rocks to and fro, well short of a turn.
    expect(highest - lowest).toBeGreaterThan(0.2);
    expect(highest - lowest).toBeLessThan(Math.PI);
  });

  it("counts the drive's angle from where the bodies start", () => {
    if (!compiled || !cycle) throw new Error("does not solve");
    const crank = compiled.spatial.get("crank");
    if (!crank) throw new Error("missing crank");
    const end = { at: crank.at, s: crank.points.get("A") as [number, number, number] };
    for (const k of [0, 45, 90, 270]) {
      const [x, y] = placePoint(cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width), end);
      const angle = (2 * Math.PI * k) / 360;
      expect(x).toBeCloseTo(0.02 * Math.cos(angle), 10);
      expect(y).toBeCloseTo(0.02 * Math.sin(angle), 10);
    }
  });

  it("is told that measures of bodies in space are not there yet", () => {
    expect(messages(`${RSSR}\nmeasures:\n  where: x(rocker.B)\n`)).toEqual([
      '"rocker" moves in space, and measures of bodies in space are not there yet',
    ]);
  });
});

const BASE = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0], U: [0, 0, 10] } }
  arm: { spatial: true, points: { O: [0, 0, 0], A: [20, 0, 0] } }
  link: { points: { O: [0, 0], A: [20, 0] } }
`;

describe("bodies in space in the format", () => {
  it("keeps the points of a body in the plane on the sheet", () => {
    expect(
      messages(
        "mekasim: 1\nbodies:\n  ground: { points: { O: [0, 0] } }\n  link: { points: { A: [0, 0, 5] } }\n",
      ),
    ).toEqual([
      "This body moves in the plane, so its points are on the sheet; write them as [x, y], or give the body spatial: true",
    ]);
  });

  it("joins a body in space only to the ground or another in space", () => {
    expect(
      messages(`${BASE}joints:\n  j: { type: spherical, connect: [arm.A, link.A] }\n`),
    ).toEqual(['"link" moves in the plane; a ball joint joins bodies in space, and the ground']);
    expect(messages(`${BASE}joints:\n  j: { type: revolute, connect: [arm.A, link.A] }\n`)).toEqual(
      ['"link" moves in the plane; it cannot be joined to a body in space yet'],
    );
    expect(
      messages(
        `${BASE}joints:\n  j: { type: revolute, connect: [ground.O, link.O], axis: [1, 0, 0] }\n`,
      ),
    ).toEqual([
      '"link" moves in the plane; every hinge between bodies in the plane turns about z, so an axis is only for bodies in space',
    ]);
  });

  it("keeps bodies in space and points off the sheet out of what is in the plane", () => {
    expect(
      messages(`${BASE}joints:\n  j: { type: slider, axis: [ground.O, arm.A], point: link.O }\n`),
    ).toEqual(['"arm" moves in space, and only bodies in the plane can be used here so far']);
    expect(
      messages(`${BASE}joints:\n  j: { type: revolute, connect: [ground.U, link.O] }\n`),
    ).toEqual([
      '"ground.U" is off the sheet, and only points on the sheet can be used here so far',
    ]);
    expect(messages(`${BASE}traces: [arm.A]\n`)).toEqual([
      '"arm" moves in space, and only bodies in the plane can be used here so far',
    ]);
  });

  it("joins a body in space to a point of the ground off the sheet", () => {
    const text = `${BASE}joints:\n  j: { type: spherical, connect: [ground.U, arm.O] }\n`;
    const simulation = simulate(text);
    expect(simulation.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const q = simulation.cycle?.q as Float64Array;
    const arm = simulation.compiled?.spatial.get("arm");
    expect(placePoint(q, { at: arm?.at as number, s: [0, 0, 0] })[2]).toBeCloseTo(0.01, 10);
  });

  it("takes each kind of pose for its own kind of body", () => {
    expect(messages(`${BASE}pose:\n  arm: [0, 0, 0]\n`)).toEqual([
      "A body in space takes its pose as { at: [x, y, z], axis, angle }",
    ]);
    expect(messages(`${BASE}pose:\n  link: { at: [0, 0, 0] }\n`)).toEqual([
      "A body in the plane takes its pose as [x, y, angle]",
    ]);
    expect(messages(`${BASE}pose:\n  arm: { at: [0, 0, 0], axis: [0, 0, 0] }\n`)).toEqual([
      "A direction cannot be [0, 0, 0]",
    ]);
  });

  it("starts a body in space where its pose puts it", () => {
    const text = `${BASE}pose:\n  arm: { at: [1, 2, 3], axis: [0, 0, 1], angle: 90 }\n`;
    const q0 = simulate(text).compiled?.model.q0 as Float64Array;
    const arm = { at: 3, s: [20 * 1e-3, 0, 0] as [number, number, number] };
    const [x, y, z] = placePoint(q0, arm);
    expect([x, y, z].map((v) => Number(v.toFixed(12)))).toEqual([0.001, 0.022, 0.003]);
  });

  it("does not let a format built on mekasim leave the plane", () => {
    const schema = documentSchema({ version: { key: "mekafit", value: 1 } });
    expect(
      load("mekafit: 1\nbodies:\n  arm: { spatial: true, points: {} }\n", schema).doc,
    ).toBeUndefined();
    expect(
      load("mekafit: 1\nbodies:\n  arm: { points: { A: [0, 0, 1] } }\n", schema).doc,
    ).toBeUndefined();
    expect(
      load("mekafit: 1\njoints:\n  j: { type: spherical, connect: [a.A, b.B] }\n", schema).doc,
    ).toBeUndefined();
    expect(load("mekafit: 1\npose:\n  arm: { at: [0, 0, 0] }\n", schema).doc).toBeUndefined();
  });
});
