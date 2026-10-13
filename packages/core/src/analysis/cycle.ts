import {
  type SolverModel,
  solveAcceleration,
  solveJerk,
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

/**
 * A cycle from positions that were found some other way than by `solveCycle`: `rows`
 * holds the coordinates at each of the times `t`, which need not be evenly spaced.
 * Velocities and accelerations are differences of the positions, since nothing else
 * says what they are. `steps` is how many samples were asked for, when the motion
 * stopped before the last of them.
 */
export function cycleFromPositions(
  t: ArrayLike<number>,
  rows: ArrayLike<number>[],
  steps = rows.length,
): Cycle {
  const count = rows.length;
  const width = rows[0]?.length ?? 0;
  const q = new Float64Array(count * width);
  rows.forEach((row, k) => {
    q.set(row, k * width);
  });

  /** The rate of change of samples at uneven times: the slope of the parabola through three. */
  function rates(of: Float64Array): Float64Array {
    const out = new Float64Array(count * width);
    if (count < 2) return out;
    for (let k = 0; k < count; k++) {
      // At an end the parabola is the one through the three samples nearest to it.
      const mid = Math.min(Math.max(k, 1), count - 2);
      const a = count === 2 ? 0 : mid - 1;
      const c = count === 2 ? 1 : mid + 1;
      const [ta, tb, tc, tk] = [t[a], t[mid], t[c], t[k]] as [number, number, number, number];
      for (let i = 0; i < width; i++) {
        const [fa, fb, fc] = [of[a * width + i], of[mid * width + i], of[c * width + i]];
        out[k * width + i] =
          count === 2
            ? (fc - fa) / (tc - ta)
            : (fa * (2 * tk - tb - tc)) / ((ta - tb) * (ta - tc)) +
              (fb * (2 * tk - ta - tc)) / ((tb - ta) * (tb - tc)) +
              (fc * (2 * tk - ta - tb)) / ((tc - ta) * (tc - tb));
      }
    }
    return out;
  }

  const qd = rates(q);
  return { steps, count, width, t: Float64Array.from(t), q, qd, qdd: rates(qd) };
}

/**
 * Jerks over a solved cycle, `count` rows of `width`. They are worked out apart from
 * the cycle, when something asks for them, since most models never do.
 */
export function cycleJerk(model: SolverModel, cycle: Cycle): Float64Array {
  const { count, width, q, qd, qdd } = cycle;
  const qddd = new Float64Array(count * width);
  for (let k = 0; k < count; k++) {
    const row = (source: Float64Array) => source.subarray(k * width, (k + 1) * width);
    qddd.set(solveJerk(model, row(q), row(qd), row(qdd)), k * width);
  }
  return qddd;
}
