import { gridCount, gridValue, type StudyPlan, type StudyRange } from "./plan.ts";
import { normalQuantile, type Random, random } from "./random.ts";

/** The streams a study draws from, so that no two uses of the seed give the same numbers. */
const SHUFFLE = 1;
const RUN = 2;

/** A normal value outside the parameter's bounds is drawn again this many times, then cut off. */
const REDRAWS = 64;

/** For each varied parameter, the order its bins are taken in: one shuffle per study. */
const shuffles = new WeakMap<StudyPlan, Uint32Array[]>();

function shuffled(plan: StudyPlan): Uint32Array[] {
  const known = shuffles.get(plan);
  if (known) return known;
  const orders = plan.varied.map((_, p) => {
    const order = Uint32Array.from({ length: plan.runs }, (_, i) => i);
    const draw = random(plan.seed, SHUFFLE, p);
    // Fisher–Yates
    for (let i = order.length - 1; i > 0; i--) {
      const j = draw.pick(i + 1);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    return order;
  });
  shuffles.set(plan, orders);
  return orders;
}

/** A value of a range from `u`, a number from 0 up to 1; normal values kept within the bounds. */
function valueAt(range: StudyRange, u: number, draw: Random): number {
  switch (range.kind) {
    case "even":
      return range.from + (range.to - range.from) * u;
    case "pick":
      return range.values[
        Math.min(Math.floor(u * range.values.length), range.values.length - 1)
      ] as number;
    case "normal": {
      const { mean, spread, min = -Infinity, max = Infinity } = range;
      let value = mean + spread * normalQuantile(u);
      for (let tries = 0; (value < min || value > max) && tries < REDRAWS; tries++) {
        value = mean + spread * draw.normal();
      }
      return Math.min(Math.max(value, min), max);
    }
  }
}

/** The value of a range at step `k` of a grid. */
function stepValue(range: StudyRange, k: number): number {
  if (range.kind === "pick") return range.values[k] as number;
  if (range.kind === "even") return gridValue(range.from, range.to, range.steps ?? 1, k);
  return range.mean;
}

/**
 * The values of run `index`, one for each varied parameter, in SI. They depend only on
 * the plan and the index, never on which runs were drawn before.
 */
export function drawRun(plan: StudyPlan, index: number): number[] {
  const draw = random(plan.seed, RUN, index);
  switch (plan.sample) {
    case "grid": {
      // The first parameter changes slowest, as in a table read row by row.
      let rest = index;
      const steps = plan.varied.map(({ range }) => gridCount(range));
      const ks = steps.map(() => 0);
      for (let p = steps.length - 1; p >= 0; p--) {
        const count = steps[p] as number;
        ks[p] = rest % count;
        rest = Math.floor(rest / count);
      }
      return plan.varied.map(({ range }, p) => stepValue(range, ks[p] as number));
    }
    case "random":
      return plan.varied.map(({ range }) => valueAt(range, share(draw), draw));
    case "spread": {
      // A Latin hypercube: each range cut into as many bins as runs, each bin used once.
      const orders = shuffled(plan);
      return plan.varied.map(({ range }, p) => {
        const bin = (orders[p] as Uint32Array)[index] as number;
        return valueAt(range, (bin + share(draw)) / plan.runs, draw);
      });
    }
  }
}

/** A number between 0 and 1, never either, so that a normal value is never endless. */
function share(draw: Random): number {
  return (draw.next() + 0.5) / 2 ** 32;
}

/** The values of run `index` by the names of the parameters. */
export function runValues(plan: StudyPlan, index: number): Record<string, number> {
  const values = drawRun(plan, index);
  return Object.fromEntries(plan.varied.map(({ name }, p) => [name, values[p] as number]));
}
