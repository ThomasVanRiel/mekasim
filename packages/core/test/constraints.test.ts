import { describe, expect, it } from "vitest";
import {
  type Constraint,
  coincident,
  GROUND_INDEX,
  pointOnLine,
  relativeAngle,
} from "../src/solver/constraints.ts";
import { mat } from "../src/solver/linalg.ts";

// Three moving bodies in an arbitrary position and state of motion.
const q = Float64Array.of(0.1, -0.2, 0.7, 0.4, 0.3, -1.1, -0.3, 0.5, 2.3);
const qd = Float64Array.of(0.5, 0.2, -1.3, -0.4, 0.9, 2.1, 0.3, -0.6, 0.8);
const n = q.length;

const normal: [number, number] = [Math.cos(0.4), Math.sin(0.4)];

const cases: [string, Constraint][] = [
  [
    "pin between two bodies",
    coincident("j", { body: 0, u: 0.12, v: -0.05 }, { body: 1, u: -0.2, v: 0.08 }),
  ],
  [
    "pin to ground",
    coincident("j", { body: GROUND_INDEX, u: 0.3, v: 0.1 }, { body: 2, u: 0.07, v: 0.11 }),
  ],
  [
    "pin with ground second",
    coincident("j", { body: 1, u: 0.07, v: 0.11 }, { body: GROUND_INDEX, u: 0.3, v: 0.1 }),
  ],
  [
    "point on a moving line",
    pointOnLine("j", { body: 0, u: 0.05, v: 0.02 }, ...normal, { body: 2, u: -0.1, v: 0.04 }),
  ],
  [
    "point on a ground line",
    pointOnLine("j", { body: GROUND_INDEX, u: 0.05, v: 0.02 }, ...normal, {
      body: 1,
      u: -0.1,
      v: 0.04,
    }),
  ],
  [
    "ground point on a moving line",
    pointOnLine("j", { body: 2, u: 0.05, v: 0.02 }, ...normal, {
      body: GROUND_INDEX,
      u: 0.2,
      v: 0.3,
    }),
  ],
  ["rotation lock", relativeAngle("j", 0, 2, 0.3)],
  ["motor on ground", relativeAngle("d", GROUND_INDEX, 1, 0.3, 4, true)],
];

function residual(c: Constraint, at: Float64Array, t = 0): Float64Array {
  const out = new Float64Array(c.size);
  c.residual(at, t, out, 0);
  return out;
}

function jacobian(c: Constraint, at: Float64Array): Float64Array {
  const jac = mat(c.size, n);
  c.jacobian(at, jac, 0);
  return jac.data;
}

function shifted(direction: Float64Array, h: number): Float64Array {
  return q.map((value, i) => value + h * direction[i]);
}

describe.each(cases)("%s", (_name, c) => {
  it("has a Jacobian matching finite differences of the residual", () => {
    const analytic = jacobian(c, q);
    const h = 1e-6;
    for (let j = 0; j < n; j++) {
      const unit = new Float64Array(n);
      unit[j] = 1;
      const plus = residual(c, shifted(unit, h));
      const minus = residual(c, shifted(unit, -h));
      for (let i = 0; i < c.size; i++) {
        expect(Math.abs(analytic[i * n + j] - (plus[i] - minus[i]) / (2 * h))).toBeLessThan(1e-8);
      }
    }
  });

  it("has an acceleration term matching the change of the Jacobian along the motion", () => {
    // Differentiating Phi_q qd = nu in time gives Phi_q qdd = -(d Phi_q / dt) qd.
    const h = 1e-6;
    const plus = jacobian(c, shifted(qd, h));
    const minus = jacobian(c, shifted(qd, -h));
    const analytic = new Float64Array(c.size);
    c.accelerationRhs(q, qd, analytic, 0);
    for (let i = 0; i < c.size; i++) {
      let numeric = 0;
      for (let j = 0; j < n; j++)
        numeric -= ((plus[i * n + j] - minus[i * n + j]) / (2 * h)) * qd[j];
      expect(Math.abs(analytic[i] - numeric)).toBeLessThan(1e-7);
    }
  });

  it("has a velocity term matching the change of the residual in time", () => {
    const h = 1e-6;
    const plus = residual(c, q, h);
    const minus = residual(c, q, -h);
    const analytic = new Float64Array(c.size);
    c.velocityRhs(analytic, 0);
    for (let i = 0; i < c.size; i++) {
      expect(Math.abs(analytic[i] + (plus[i] - minus[i]) / (2 * h))).toBeLessThan(1e-8);
    }
  });
});
