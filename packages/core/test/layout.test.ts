import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cycleJerk, solveCycle } from "../src/analysis/cycle.ts";
import { compile } from "../src/compile/compile.ts";
import { load } from "../src/schema/load.ts";
import type { Constraint } from "../src/solver/constraints.ts";
import { dragTo } from "../src/solver/drag.ts";
import { maxAbs } from "../src/solver/linalg.ts";
import { analyzeMobility } from "../src/solver/mobility.ts";
import {
  blocks,
  jacobian,
  residual,
  type SolverModel,
  solvePosition,
} from "../src/solver/solve.ts";

/** The four-bar example: crank, coupler and rocker are bodies 0, 1 and 2. */
function fourBar(): SolverModel {
  const text = readFileSync(
    new URL("../../../examples/four-bar.mekasim.yaml", import.meta.url),
    "utf8",
  );
  const { doc } = load(text);
  if (!doc) throw new Error("invalid model");
  const { compiled } = compile(doc);
  if (!compiled) throw new Error("does not compile");
  return compiled.model;
}

const ROCKER = 2 * 3 + 2;
const COUPLER_X = 1 * 3;

/**
 * Stands in for a body with coordinates of another kind: two coordinates after the
 * planar bodies, `s0 = cos(rocker angle)` and, if `both`, `s1 = x of the coupler`.
 */
function standIn(extra: number, both: boolean): Constraint {
  return {
    source: "stand_in",
    driver: false,
    size: both ? 2 : 1,
    residual(q, _t, out, row) {
      out[row] = q[extra] - Math.cos(q[ROCKER]);
      if (both) out[row + 1] = q[extra + 1] - q[COUPLER_X];
    },
    jacobian(q, jac, row) {
      jac.data[row * jac.cols + extra] += 1;
      jac.data[row * jac.cols + ROCKER] += Math.sin(q[ROCKER]);
      if (both) {
        jac.data[(row + 1) * jac.cols + extra + 1] += 1;
        jac.data[(row + 1) * jac.cols + COUPLER_X] -= 1;
      }
    },
    velocityRhs(out, row) {
      out[row] = 0;
      if (both) out[row + 1] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      out[row] = -Math.cos(q[ROCKER]) * qd[ROCKER] ** 2;
      if (both) out[row + 1] = 0;
    },
  };
}

/** The four-bar with the stand-in's two coordinates after its bodies. */
function extended(planar: SolverModel, both = true): SolverModel {
  const extra = planar.q0.length;
  const q0 = new Float64Array(extra + 2);
  q0.set(planar.q0);
  return {
    ...planar,
    spatial: [{ id: "extra", size: 2 }],
    constraints: [...planar.constraints, standIn(extra, both)],
    q0,
  };
}

/** Assembled at the start, as the first sample of a cycle. */
function assembled(model: SolverModel): Float64Array {
  const q = Float64Array.from(model.q0);
  expect(solvePosition(model, q, 0, 200).ok).toBe(true);
  return q;
}

describe("coordinates after the planar bodies", () => {
  const planar = fourBar();
  const n = planar.q0.length;

  it("lays out the planar bodies first, then the other blocks", () => {
    expect(blocks(extended(planar))).toEqual([
      { id: "crank", at: 0, size: 3 },
      { id: "coupler", at: 3, size: 3 },
      { id: "rocker", at: 6, size: 3 },
      { id: "extra", at: 9, size: 2 },
    ]);
  });

  it("gives the Jacobian a column for every coordinate, the planar ones as before", () => {
    const model = extended(planar);
    const q = assembled(model);
    const wide = jacobian(model, q);
    const narrow = jacobian(planar, q.subarray(0, n));
    expect(wide.cols).toBe(n + 2);
    for (let i = 0; i < narrow.rows; i++) {
      for (let j = 0; j < narrow.cols; j++) {
        expect(wide.data[i * wide.cols + j]).toBe(narrow.data[i * narrow.cols + j]);
      }
      expect(wide.data[i * wide.cols + n]).toBe(0);
      expect(wide.data[i * wide.cols + n + 1]).toBe(0);
    }
  });

  it("solves the extra coordinates along with the planar ones", () => {
    const model = extended(planar);
    const q = assembled(model);
    expect(q[n]).toBeCloseTo(Math.cos(q[ROCKER]), 12);
    expect(q[n + 1]).toBeCloseTo(q[COUPLER_X], 12);
    const alone = assembled(planar);
    expect(maxAbs(q.subarray(0, n).map((value, i) => value - alone[i]))).toBeLessThan(1e-9);
  });

  it("counts every coordinate and finds the same mobility", () => {
    const narrow = analyzeMobility(planar, assembled(planar));
    const model = extended(planar);
    const wide = analyzeMobility(model, assembled(model));
    expect(wide).toEqual({ ...narrow, coordinates: n + 2 });
    expect(wide).toMatchObject({ mobility: 1, free: 0, redundant: 0 });
  });

  it("names a block left free as a free body", () => {
    const model = extended(planar, false);
    const mobility = analyzeMobility(model, assembled(model));
    expect(mobility).toMatchObject({ coordinates: n + 2, mobility: 2, free: 1 });
    expect(mobility.freeBodies).toEqual(["extra"]);
  });

  it("gives the planar jerks as before, and the extra ones that follow from them", () => {
    const model = extended(planar);
    const narrowCycle = solveCycle(planar, 0.2, 36);
    const wideCycle = solveCycle(model, 0.2, 36);
    expect(wideCycle.count).toBe(36);
    const narrow = cycleJerk(planar, narrowCycle);
    const wide = cycleJerk(model, wideCycle);
    const scale = maxAbs(narrow);
    for (let k = 0; k < 36; k++) {
      const row = wide.subarray(k * (n + 2), (k + 1) * (n + 2));
      for (let i = 0; i < n; i++) {
        expect(Math.abs(row[i] - narrow[k * n + i])).toBeLessThan(1e-6 * scale);
      }
      // s1 follows the coupler's x, so its jerk does too.
      expect(Math.abs(row[n + 1] - row[COUPLER_X])).toBeLessThan(1e-6 * scale);
    }
  });

  it("drags the planar bodies as before and keeps the stand-in closed", () => {
    const model = extended(planar);
    const tip = { body: 0, u: 0.04, v: 0 };
    const target = [0.04 * Math.cos(1), 0.04 * Math.sin(1)] as const;

    const narrow = assembled(planar);
    expect(dragTo(planar, narrow, tip, ...target)).toBeLessThan(1e-8);
    const wide = assembled(model);
    expect(dragTo(model, wide, tip, ...target)).toBeLessThan(1e-8);

    expect(maxAbs(wide.subarray(0, n).map((value, i) => value - narrow[i]))).toBeLessThan(1e-6);
    const joints = { ...model, constraints: model.constraints.filter((c) => !c.driver) };
    expect(maxAbs(residual(joints, wide, 0))).toBeLessThan(1e-9);
  });
});
