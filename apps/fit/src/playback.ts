/** Playback of a run: how the position in it moves on with time. No drawing here. */

/** Playback speeds, as shares of real time. */
export const RATES = [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

/** The fastest rate at which one cycle still takes long enough to follow by eye. */
export function comfortableRate(period: number): number {
  return RATES.find((rate) => period / rate >= 1.5) ?? (RATES.at(-1) as number);
}

export interface Run {
  /** Samples in the run. */
  count: number;
  /** Seconds from one sample to the next. */
  dt: number;
  /** Whether the last sample leads back into the first. */
  periodic: boolean;
}

/**
 * The position in a run, as a sample index with a fraction, after `seconds` more at
 * `rate`. A run that repeats goes round; one that does not starts again from its
 * beginning once it has reached its end.
 */
export function advance(step: number, seconds: number, rate: number, run: Run): number {
  if (run.count < 2 || run.dt <= 0) return 0;
  // A tab that was in the background comes back with a long gap; do not leap over it.
  const next = step + (Math.min(seconds, 0.1) * rate) / run.dt;
  const end = run.periodic ? run.count : run.count - 1;
  if (next < end) return next;
  return run.periodic ? next % run.count : 0;
}

/** The position one sample on or back, going round at the ends. */
export function stepped(step: number, by: 1 | -1, count: number): number {
  if (count < 1) return 0;
  return (Math.floor(step) + by + count) % count;
}
