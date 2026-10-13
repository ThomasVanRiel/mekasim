import { type Mat, matFrom, solveLinear } from "@mekasim/core";

export interface QpSolution {
  /** The coordinates that minimise the quadratic objective. */
  x: Float64Array;
  /** One non-negative multiplier per inequality. */
  multipliers: Float64Array;
  /** Indices of the inequalities carrying a positive multiplier. */
  active: number[];
}

const TOLERANCE = 1e-10;

function dotRow(a: Mat, row: number, x: Float64Array): number {
  let sum = 0;
  for (let j = 0; j < a.cols; j++) sum += a.data[row * a.cols + j] * x[j];
  return sum;
}

/** Cholesky factor of a symmetric positive-definite matrix. */
function cholesky(a: Mat): Float64Array {
  if (a.rows !== a.cols) throw new Error("The QP Hessian must be square");
  const n = a.rows;
  const lower = new Float64Array(n * n);
  let scale = 0;
  for (const value of a.data) scale = Math.max(scale, Math.abs(value));
  const symmetryTolerance = Math.max(1, scale) * 1e-12;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      if (Math.abs(a.data[i * n + j] - a.data[j * n + i]) > symmetryTolerance)
        throw new Error("The QP Hessian must be symmetric");
      let value = a.data[i * n + j];
      for (let k = 0; k < j; k++) value -= lower[i * n + k] * lower[j * n + k];
      if (i === j) {
        if (value <= Math.max(1, scale) * 1e-14)
          throw new Error("The QP Hessian must be positive definite");
        lower[i * n + j] = Math.sqrt(value);
      } else {
        lower[i * n + j] = value / lower[j * n + j];
      }
    }
  }
  return lower;
}

function choleskySolve(lower: Float64Array, rhs: Float64Array): Float64Array {
  const n = rhs.length;
  const x = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) x[i] -= lower[i * n + j] * x[j];
    x[i] /= lower[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= lower[j * n + i] * x[j];
    x[i] /= lower[i * n + i];
  }
  return x;
}

function dimensions(hessian: Mat, gradient: Float64Array, normals: Mat, limits: Float64Array) {
  const n = hessian.rows;
  if (gradient.length !== n) throw new Error("The QP gradient does not fit its Hessian");
  if (normals.cols !== n) throw new Error("The QP inequalities do not fit its Hessian");
  if (limits.length !== normals.rows) throw new Error("The QP inequalities need one limit per row");
}

/**
 * Minimise `1/2 x' H x + f' x`, subject to `A x >= b`.
 *
 * This is the dual active-set form of Goldfarb–Idnani. `H` must be positive
 * definite. An undefined result means the inequalities have no common solution.
 */
export function solveQp(
  hessian: Mat,
  gradient: Float64Array,
  normals: Mat,
  limits: Float64Array,
): QpSolution | undefined {
  dimensions(hessian, gradient, normals, limits);
  const n = hessian.rows;
  const m = normals.rows;
  const lower = cholesky(hessian);
  const x0 = choleskySolve(
    lower,
    gradient.map((value) => -value),
  );

  // Column i of response is H^-1 times row i of A. The dual Hessian is A H^-1 A'.
  const response = new Float64Array(n * m);
  const dual = new Float64Array(m * m);
  const residual = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const normal = Float64Array.from({ length: n }, (_, j) => normals.data[i * n + j]);
    const moved = choleskySolve(lower, normal);
    for (let j = 0; j < n; j++) response[j * m + i] = moved[j];
    residual[i] = limits[i] - dotRow(normals, i, x0);
  }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let value = 0;
      for (let k = 0; k < n; k++) value += normals.data[i * n + k] * response[k * m + j];
      dual[i * m + j] = value;
      dual[j * m + i] = value;
    }
  }

  // Solve the non-negative dual with an active set. A dual direction with no
  // curvature and positive gain means the primal inequalities are infeasible.
  const multipliers = new Float64Array(m);
  const passive = new Set<number>();
  const scale = Math.max(1, ...Array.from(residual, Math.abs));
  const tolerance = TOLERANCE * scale;
  const iterations = Math.max(100, 20 * (m + 1) * (m + 1));

  for (let iteration = 0; iteration < iterations; iteration++) {
    let entering = -1;
    let greatest = tolerance;
    for (let i = 0; i < m; i++) {
      if (passive.has(i)) continue;
      let gain = residual[i];
      for (let j = 0; j < m; j++) gain -= dual[i * m + j] * multipliers[j];
      if (gain > greatest) {
        greatest = gain;
        entering = i;
      }
    }

    if (entering < 0) {
      const x = Float64Array.from(x0);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < m; i++) x[j] += response[j * m + i] * multipliers[i];
      // This final check also catches a zero inequality row with a positive limit.
      for (let i = 0; i < m; i++)
        if (dotRow(normals, i, x) < limits[i] - tolerance) return undefined;
      return { x, multipliers, active: [...passive].filter((i) => multipliers[i] > tolerance) };
    }

    passive.add(entering);
    for (;;) {
      const active = [...passive];
      const system = matFrom(active.map((i) => active.map((j) => dual[i * m + j] as number)));
      const rhs = Float64Array.from(active, (i) => residual[i]);
      const candidate = solveLinear(system, rhs);

      let equationError = 0;
      for (let row = 0; row < active.length; row++) {
        let value = 0;
        for (let col = 0; col < active.length; col++)
          value += system.data[row * active.length + col] * candidate[col];
        equationError = Math.max(equationError, Math.abs(value - rhs[row]));
      }
      if (equationError > tolerance) {
        // The rows held so far say the same thing more than once, and not all of it
        // can be met with equality. What is left over is a way to shift force between
        // them at no cost: go along it until one of them carries nothing, and let
        // that one go. If none would, nothing satisfies the rows at all.
        const shift = active.map((_, row) => {
          let value = rhs[row] as number;
          for (let col = 0; col < active.length; col++)
            value -= system.data[row * active.length + col] * (candidate[col] as number);
          return value;
        });
        let alpha = Number.POSITIVE_INFINITY;
        active.forEach((i, k) => {
          const by = shift[k] as number;
          if (by < -tolerance) alpha = Math.min(alpha, multipliers[i] / -by);
        });
        if (!Number.isFinite(alpha)) return undefined;
        let dropped = false;
        active.forEach((i, k) => {
          multipliers[i] += alpha * (shift[k] as number);
          if ((shift[k] as number) < -tolerance && multipliers[i] <= tolerance) {
            multipliers[i] = 0;
            passive.delete(i);
            dropped = true;
          }
        });
        if (!dropped) return undefined;
        continue;
      }

      const negative = active.filter((_, k) => (candidate[k] as number) <= tolerance);
      if (negative.length === 0) {
        multipliers.fill(0);
        active.forEach((i, k) => {
          multipliers[i] = candidate[k] as number;
        });
        break;
      }

      let alpha = 1;
      for (const i of negative) {
        const k = active.indexOf(i);
        const old = multipliers[i];
        alpha = Math.min(alpha, old / (old - (candidate[k] as number)));
      }
      active.forEach((i, k) => {
        multipliers[i] += alpha * ((candidate[k] as number) - multipliers[i]);
      });
      for (const i of active) {
        if (multipliers[i] <= tolerance) {
          multipliers[i] = 0;
          passive.delete(i);
        }
      }
    }
  }
  return undefined;
}
