import { type CompiledLock, jointValue } from "./inequality.ts";

/** What the pins of the locks not yet in add to the energy at one position. */
export interface CatchTerms {
  energy: number;
  /** Derivative of the energy with respect to all moving-body coordinates. */
  gradient: Float64Array;
}

/**
 * A lock with a catch pulls its joint in over the last of the way to where it drops, as
 * a sprung pin with a pointed tip draws its hole under it: within `catch` short of `at`
 * it turns or pushes the joint towards `at` with `pull`, and on past it until the lock is
 * in. Its energy falls evenly as the joint comes in, and is the same anywhere further
 * out, so it is continuous; once the lock is in, it pulls no more.
 */
export function catchTerms(
  locks: CompiledLock[],
  engaged: ReadonlySet<string>,
  q: Float64Array,
): CatchTerms {
  const gradient = new Float64Array(q.length);
  let energy = 0;
  for (const lock of locks) {
    if (!lock.catch || engaged.has(lock.id)) continue;
    const slope = new Float64Array(q.length);
    const value = jointValue(lock.value, q, slope);
    // How far the joint is short of where the lock drops, and which way that is.
    const way = lock.drops === "up" ? -1 : 1;
    // Past its place it still pulls until it is found in, at the end of the sample: a
    // pull that ended there would leave a sharp point where nothing settles.
    const short = way * (value - lock.at);
    const { within, pull } = lock.catch;
    if (short >= within) {
      energy += pull * within;
      continue;
    }
    energy += pull * short;
    for (let i = 0; i < q.length; i++) gradient[i] += pull * way * (slope[i] as number);
  }
  return { energy, gradient };
}
