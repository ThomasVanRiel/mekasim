import {
  type SolverModel,
  solveAcceleration,
  solvePosition,
  solveVelocity,
} from "../solver/solve.ts";

export interface CycleFailure {
  /** Index of the first sample that could not be solved. */
  step: number;
  time: number;
  /** Joints and drivers that could not be closed, worst first. */
  open: string[];
}

/** Motion sampled at evenly spaced times over one cycle. */
export interface Cycle {
  /** Samples asked for. */
  steps: number;
  /** Samples solved; less than `steps` when the mechanism cannot complete the cycle. */
  count: number;
  /** Coordinates per sample. */
  width: number;
  t: Float64Array;
  /** Positions, velocities and accelerations, `count` rows of `width`. */
  q: Float64Array;
  qd: Float64Array;
  qdd: Float64Array;
  failure?: CycleFailure;
}

/**
 * Solve the motion over one period. Each sample starts from an extrapolation of the
 * previous one, which keeps the mechanism on one assembly branch. With a period of
 * 0 only the starting position is solved.
 */
export function solveCycle(model: SolverModel, period: number, steps: number): Cycle {
  const width = model.q0.length;
  const total = period > 0 ? steps : 1;
  const dt = period > 0 ? period / steps : 0;
  const t = new Float64Array(total);
  const q = new Float64Array(total * width);
  const qd = new Float64Array(total * width);
  const qdd = new Float64Array(total * width);
  const cycle: Cycle = { steps: total, count: 0, width, t, q, qd, qdd };

  const current = Float64Array.from(model.q0);
  let velocity: Float64Array = new Float64Array(width);
  let acceleration: Float64Array = new Float64Array(width);

  for (let k = 0; k < total; k++) {
    const time = k * dt;
    const previous = Float64Array.from(current);
    for (let i = 0; i < width; i++) {
      current[i] = current[i] + velocity[i] * dt + 0.5 * acceleration[i] * dt * dt;
    }
    // The first sample assembles the mechanism from the starting pose and may need many iterations.
    let result = solvePosition(model, current, time, k === 0 ? 200 : 50);
    if (!result.ok && k > 0) {
      current.set(previous);
      result = solvePosition(model, current, time);
    }
    if (!result.ok) {
      cycle.failure = { step: k, time, open: result.open };
      break;
    }
    velocity = solveVelocity(model, current);
    acceleration = solveAcceleration(model, current, velocity);
    t[k] = time;
    q.set(current, k * width);
    qd.set(velocity, k * width);
    qdd.set(acceleration, k * width);
    cycle.count = k + 1;
  }

  if (cycle.count < total) {
    cycle.t = t.subarray(0, cycle.count);
    cycle.q = q.subarray(0, cycle.count * width);
    cycle.qd = qd.subarray(0, cycle.count * width);
    cycle.qdd = qdd.subarray(0, cycle.count * width);
  }
  return cycle;
}
