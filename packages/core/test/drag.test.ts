import { describe, expect, it } from "vitest";
import { compile } from "../src/compile/compile.ts";
import { load } from "../src/schema/load.ts";
import { dragTo } from "../src/solver/drag.ts";
import { maxAbs } from "../src/solver/linalg.ts";
import { residual, type SolverModel, solvePosition } from "../src/solver/solve.ts";

const FOUR_BAR = `
mekasim: 1
bodies:
  ground: { points: { O2: [0, 0], O4: [180, 0] } }
  crank: { points: { O: [0, 0], A: [40, 0] } }
  coupler: { points: { A: [0, 0], B: [160, 0] } }
  rocker: { points: { B: [0, 0], O: [110, 0] } }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }
  pin_b: { type: revolute, connect: [coupler.B, rocker.B] }
  rock: { type: revolute, connect: [rocker.O, ground.O4] }
pose:
  coupler: [40, 0, 40]
  rocker: [160, 110, -80]
`;

function assembled(text: string): { model: SolverModel; q: Float64Array } {
  const { doc } = load(text);
  if (!doc) throw new Error("invalid model");
  const { compiled } = compile(doc);
  if (!compiled) throw new Error("does not compile");
  const q = Float64Array.from(compiled.model.q0);
  expect(solvePosition(compiled.model, q, 0, 200).ok).toBe(true);
  return { model: compiled.model, q };
}

/** The crank tip: body 0, 40 mm from its pivot. */
const TIP = { body: 0, u: 0.04, v: 0 };

describe("dragTo", () => {
  it("moves a point to a place it can reach, keeping every joint closed", () => {
    const { model, q } = assembled(FOUR_BAR);
    const target = [0.04 * Math.cos(1), 0.04 * Math.sin(1)] as const;
    const distance = dragTo(model, q, TIP, target[0], target[1]);
    expect(distance).toBeLessThan(1e-8);
    expect(q[2]).toBeCloseTo(1, 6);
    expect(maxAbs(residual(model, q, 0))).toBeLessThan(1e-9);
  });

  it("goes as near as the joints allow when the target is out of reach", () => {
    const { model, q } = assembled(FOUR_BAR);
    // Far away at 45 degrees: the crank can only point at it.
    const distance = dragTo(model, q, TIP, 1, 1);
    expect(q[2]).toBeCloseTo(Math.PI / 4, 4);
    expect(distance).toBeCloseTo(Math.SQRT2 - 0.04, 6);
    expect(maxAbs(residual(model, q, 0))).toBeLessThan(1e-9);
  });

  it("follows a drag through many small moves without leaving its assembly", () => {
    const { model, q } = assembled(FOUR_BAR);
    // Without a driver the assembled crank is not exactly at 0; put it there first.
    dragTo(model, q, TIP, 0.04, 0);
    const rockerStart = q[8];
    for (let k = 1; k <= 72; k++) {
      const angle = (k * 5 * Math.PI) / 180;
      dragTo(model, q, TIP, 0.04 * Math.cos(angle), 0.04 * Math.sin(angle));
    }
    // One full turn of the crank brings the rocker back to where it began.
    expect(q[8]).toBeCloseTo(rockerStart, 6);
    expect(maxAbs(residual(model, q, 0))).toBeLessThan(1e-9);
  });

  it("ignores drivers, so a driven mechanism can still be pulled", () => {
    const { model, q } = assembled(`${FOUR_BAR}drivers:\n  motor: { joint: main, speed: 60 }\n`);
    expect(dragTo(model, q, TIP, 0, 0.04)).toBeLessThan(1e-8);
    expect(q[2]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("leaves a rigid structure where it is", () => {
    const { model, q } = assembled(`
mekasim: 1
bodies:
  ground: { points: { A: [0, 0], B: [100, 0] } }
  left: { points: { A: [0, 0], C: [50, 80] } }
  right: { points: { B: [100, 0], C: [50, 80] } }
joints:
  a: { type: revolute, connect: [ground.A, left.A] }
  b: { type: revolute, connect: [ground.B, right.B] }
  c: { type: revolute, connect: [left.C, right.C] }
`);
    const before = Float64Array.from(q);
    dragTo(model, q, { body: 0, u: 0.05, v: 0.08 }, 0.2, 0.2);
    expect(Array.from(q)).toEqual(Array.from(before));
  });

  it("moves a body that nothing holds", () => {
    const { model, q } = assembled(
      "mekasim: 1\nbodies:\n  loose: { points: { A: [0, 0], B: [50, 0] } }\n",
    );
    expect(dragTo(model, q, { body: 0, u: 0.05, v: 0 }, 0.3, 0.1)).toBeLessThan(1e-8);
  });
});
