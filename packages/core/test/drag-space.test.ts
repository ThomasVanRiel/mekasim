import { describe, expect, it } from "vitest";
import { simulate } from "../src/simulate.ts";
import { dragPointTo } from "../src/solver/drag.ts";
import { maxAbs } from "../src/solver/linalg.ts";
import { residual } from "../src/solver/solve.ts";
import { placePoint } from "../src/solver/spatial.ts";

// A rod on a ball joint at the origin, free to swing any way.
const BALL = `mekasim: 1
bodies:
  ground:
    points: { O: [0, 0, 0] }
  rod:
    spatial: true
    points: { O: [0, 0, 0], T: [100, 0, 0] }
joints:
  ball: { type: spherical, connect: [ground.O, rod.O] }
`;

describe("dragging a point in space", () => {
  it("swings a rod on a ball joint towards a target and keeps the joint closed", () => {
    const compiled = simulate(BALL).compiled;
    if (!compiled) throw new Error("did not compile");
    const rod = compiled.spatial.get("rod");
    if (!rod) throw new Error("no rod");
    const q = Float64Array.from(compiled.model.q0);
    const point = { at: rod.at, s: rod.points.get("T") as [number, number, number] };
    const left = dragPointTo(compiled.model, q, point, [0, 0.06, 0.08]);
    expect(left).toBeLessThan(1e-6);
    expect(maxAbs(residual(compiled.model, q, 0))).toBeLessThan(1e-8);
    const end = placePoint(q, point);
    expect(Math.hypot(...end)).toBeCloseTo(0.1, 8);
  });

  it("does not count how far the point is along the view", () => {
    const compiled = simulate(BALL).compiled;
    if (!compiled) throw new Error("did not compile");
    const rod = compiled.spatial.get("rod");
    if (!rod) throw new Error("no rod");
    const q = Float64Array.from(compiled.model.q0);
    const point = { at: rod.at, s: rod.points.get("T") as [number, number, number] };
    // Out of reach along z, but looking along z only x and y count.
    const left = dragPointTo(compiled.model, q, point, [0.06, 0.08, 5], [0, 0, 1]);
    expect(left).toBeLessThan(1e-6);
    expect(placePoint(q, point)[1]).toBeCloseTo(0.08, 8);
  });
});
