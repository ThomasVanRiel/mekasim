import type { Constraint } from "./constraints.ts";
import { type Mat, mat, maxAbs, norm2, solveLinear } from "./linalg.ts";

export interface SolverModel {
  /** Ids of the moving bodies; body `i` owns `q[3i..3i+2]`. */
  bodies: string[];
  constraints: Constraint[];
  /** Starting position, used as the first guess. */
  q0: Float64Array;
}

/** Constraint error accepted as closed, in metres and radians. */
export const TOLERANCE = 1e-10;

export function rowCount(constraints: Constraint[]): number {
  return constraints.reduce((sum, c) => sum + c.size, 0);
}

export function residual(model: SolverModel, q: Float64Array, t: number): Float64Array {
  const out = new Float64Array(rowCount(model.constraints));
  let row = 0;
  for (const c of model.constraints) {
    c.residual(q, t, out, row);
    row += c.size;
  }
  return out;
}

export function jacobian(
  model: SolverModel,
  q: Float64Array,
  constraints = model.constraints,
): Mat {
  const jac = mat(rowCount(constraints), 3 * model.bodies.length);
  let row = 0;
  for (const c of constraints) {
    c.jacobian(q, jac, row);
    row += c.size;
  }
  return jac;
}

export interface PositionResult {
  ok: boolean;
  iterations: number;
  /** Largest remaining constraint error. */
  error: number;
  /** Joints and drivers left open when the solve failed, worst first. */
  open: string[];
}

function openSources(model: SolverModel, phi: Float64Array): string[] {
  const worst = new Map<string, number>();
  let row = 0;
  for (const c of model.constraints) {
    const error = maxAbs(phi.subarray(row, row + c.size));
    row += c.size;
    if (error > TOLERANCE) worst.set(c.source, Math.max(worst.get(c.source) ?? 0, error));
  }
  return [...worst].sort((a, b) => b[1] - a[1]).map(([source]) => source);
}

/**
 * Close all constraints at time `t`, starting from `q` and updating it in place.
 * Newton iteration with a backtracking line search; the linear step is the
 * minimum-norm least-squares one, so free and over-constrained models both work
 * and the result stays on the branch nearest the starting guess.
 */
export function solvePosition(
  model: SolverModel,
  q: Float64Array,
  t: number,
  maxIterations = 50,
): PositionResult {
  let phi = residual(model, q, t);
  const trial = new Float64Array(q.length);

  for (let iteration = 0; ; iteration++) {
    const error = maxAbs(phi);
    if (error < TOLERANCE) return { ok: true, iterations: iteration, error, open: [] };
    if (iteration >= maxIterations) break;

    const step = solveLinear(jacobian(model, q), phi);
    const before = norm2(phi);
    let scale = 1;
    let next = phi;
    for (;;) {
      for (let i = 0; i < q.length; i++) trial[i] = q[i] - scale * step[i];
      next = residual(model, trial, t);
      if (norm2(next) < (1 - 1e-4 * scale) * before) break;
      scale /= 2;
      if (scale < 1e-6)
        return { ok: false, iterations: iteration, error, open: openSources(model, phi) };
    }
    q.set(trial);
    phi = next;
  }
  return {
    ok: false,
    iterations: maxIterations,
    error: maxAbs(phi),
    open: openSources(model, phi),
  };
}

/** Velocities `qd` satisfying the constraints at position `q`. */
export function solveVelocity(model: SolverModel, q: Float64Array): Float64Array {
  const rhs = new Float64Array(rowCount(model.constraints));
  let row = 0;
  for (const c of model.constraints) {
    c.velocityRhs(rhs, row);
    row += c.size;
  }
  return solveLinear(jacobian(model, q), rhs);
}

function accelerationRhs(model: SolverModel, q: Float64Array, qd: Float64Array): Float64Array {
  const rhs = new Float64Array(rowCount(model.constraints));
  let row = 0;
  for (const c of model.constraints) {
    c.accelerationRhs(q, qd, rhs, row);
    row += c.size;
  }
  return rhs;
}

/** Accelerations `qdd` satisfying the constraints at position `q` and velocity `qd`. */
export function solveAcceleration(
  model: SolverModel,
  q: Float64Array,
  qd: Float64Array,
): Float64Array {
  return solveLinear(jacobian(model, q), accelerationRhs(model, q, qd));
}

/**
 * Jerks `qddd` satisfying the constraints. Differentiating `Phi_q qdd = gamma` in time
 * gives `Phi_q qddd = d(gamma)/dt - d(Phi_q)/dt qdd`. The right-hand side is taken as
 * a central difference a very short way along the motion, so a constraint needs no
 * third derivative of its own, and the result does not depend on the sampling of the cycle.
 */
export function solveJerk(
  model: SolverModel,
  q: Float64Array,
  qd: Float64Array,
  qdd: Float64Array,
): Float64Array {
  // A step that turns the fastest body by about 1e-5 rad: small enough that what the
  // difference leaves out is far below it, large enough to stay clear of rounding.
  let turning = 1;
  for (let i = 2; i < qd.length; i += 3) turning = Math.max(turning, Math.abs(qd[i]));
  const h = 1e-5 / turning;

  /** `gamma - Phi_q qdd` a time `dt` along the motion, with `qdd` held as it is. */
  function along(dt: number): Float64Array {
    const at = q.map((value, i) => value + dt * qd[i]);
    const out = accelerationRhs(
      model,
      at,
      qd.map((value, i) => value + dt * qdd[i]),
    );
    const jac = jacobian(model, at);
    for (let i = 0; i < jac.rows; i++) {
      for (let j = 0; j < jac.cols; j++) out[i] = out[i] - jac.data[i * jac.cols + j] * qdd[j];
    }
    return out;
  }

  const ahead = along(h);
  const behind = along(-h);
  return solveLinear(
    jacobian(model, q),
    ahead.map((value, i) => (value - behind[i]) / (2 * h)),
  );
}
