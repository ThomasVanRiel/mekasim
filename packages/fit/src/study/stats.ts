import { gridValue, type StudyPlan } from "./plan.ts";
import type { RunResult } from "./run.ts";

/** A share with its 95% range. */
export interface Share {
  share: number;
  low: number;
  high: number;
}

/** z for a two-sided 95% range. */
const Z95 = 1.959963984540054;

/**
 * The Wilson score interval for `passed` out of `total`: unlike the plain one it stays within
 * 0 and 1, and means something for a few runs or a share near either end.
 */
export function wilson(passed: number, total: number, z = Z95): Share {
  if (total === 0) return { share: 0, low: 0, high: 1 };
  const p = passed / total;
  const z2 = z * z;
  const centre = (p + z2 / (2 * total)) / (1 + z2 / total);
  const half = (z / (1 + z2 / total)) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Runs in one part of a parameter's range. */
export interface Bin {
  /** The part of the range, in SI; for picked values both ends are the value. */
  from: number;
  to: number;
  passed: number;
  failed: number;
}

export interface ParameterRates {
  name: string;
  bins: Bin[];
  /** How far apart the best and the worst pass rate of its bins with runs in them are. */
  difference: number;
}

export interface StudySummary {
  /** Runs done so far. */
  done: number;
  passed: number;
  failed: number;
  unsolved: number;
  /** Share passed over the runs that were solved. */
  rate: Share;
  parameters: ParameterRates[];
  /** The two parameters whose pass rate changes most over their ranges. */
  telling: string[];
  /** Each condition that was not met, with in how many runs, largest first. */
  failures: { condition: string; count: number }[];
  /** Each condition alone: in how many of the solved runs it was met, and that share. */
  conditions: { condition: string; met: number; rate: Share }[];
}

export const BINS = 10;

/** The ends of the part of a range the bins cover. */
function extent(plan: StudyPlan, p: number, results: RunResult[]): [number, number] | undefined {
  const { range, name } = plan.varied[p] as StudyPlan["varied"][number];
  if (range.kind === "even") return [range.from, range.to];
  if (range.kind === "pick") return undefined;
  // A normal range: as far as the runs went.
  let low = Infinity;
  let high = -Infinity;
  for (const { values } of results) {
    const value = values[name] as number;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return low <= high ? [low, high] : [range.mean, range.mean];
}

/**
 * The pass rate in parts of each parameter's range: ten bins, or one per picked value.
 * The bins of a normal range reach as far as `reach`, the runs it spans.
 */
function rates(plan: StudyPlan, solved: RunResult[], reach: RunResult[]): ParameterRates[] {
  return plan.varied.map(({ name, range }, p) => {
    let bins: Bin[];
    let binOf: (value: number) => number;
    const ends = extent(plan, p, reach);
    const steps = range.kind === "even" ? range.steps : undefined;
    if (range.kind === "pick" || steps || !ends) {
      // A few values only, as picked or as a grid takes them: a bin for each.
      const values =
        range.kind === "pick"
          ? [...new Set(range.values)].sort((a, b) => a - b)
          : range.kind === "even" && steps
            ? Array.from({ length: steps }, (_, k) => gridValue(range.from, range.to, steps, k))
            : [];
      bins = values.map((value) => ({ from: value, to: value, passed: 0, failed: 0 }));
      binOf = (value) => values.indexOf(value);
    } else {
      const [from, to] = ends;
      const width = (to - from) / BINS;
      bins = Array.from({ length: BINS }, (_, i) => ({
        from: from + width * i,
        to: i === BINS - 1 ? to : from + width * (i + 1),
        passed: 0,
        failed: 0,
      }));
      binOf = (value) =>
        width > 0 ? Math.min(BINS - 1, Math.max(0, Math.floor((value - from) / width))) : 0;
    }
    for (const result of solved) {
      const bin = bins[binOf(result.values[name] as number)];
      if (!bin) continue;
      if (result.outcome === "passed") bin.passed++;
      else bin.failed++;
    }
    const shares = bins
      .filter((bin) => bin.passed + bin.failed > 0)
      .map((bin) => bin.passed / (bin.passed + bin.failed));
    const difference = shares.length > 1 ? Math.max(...shares) - Math.min(...shares) : 0;
    return { name, bins, difference };
  });
}

/**
 * What a study's runs come to: pass rate, rates over each range, and the failures.
 * `all` are every run of the study, when `results` are some of them: the bins over a
 * normal range are then the same for both.
 */
export function summarize(
  plan: StudyPlan,
  results: RunResult[],
  all: RunResult[] = results,
): StudySummary {
  const solved = results.filter(({ outcome }) => outcome !== "unsolved");
  const passed = solved.filter(({ outcome }) => outcome === "passed").length;
  const parameters = rates(
    plan,
    solved,
    all.filter(({ outcome }) => outcome !== "unsolved"),
  );
  const telling = [...parameters]
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 2)
    .map(({ name }) => name);
  const counts = new Map<string, number>();
  for (const { failed } of solved) {
    for (const condition of failed) counts.set(condition, (counts.get(condition) ?? 0) + 1);
  }
  const failures = [...counts]
    .map(([condition, count]) => ({ condition, count }))
    .sort((a, b) => b.count - a.count || a.condition.localeCompare(b.condition));
  const conditions = conditionsOf(solved).map((condition) => {
    const met = solved.length - (counts.get(condition) ?? 0);
    return { condition, met, rate: wilson(met, solved.length) };
  });
  return {
    done: results.length,
    passed,
    failed: solved.length - passed,
    unsolved: results.length - solved.length,
    rate: wilson(passed, solved.length),
    parameters,
    telling,
    failures,
    conditions,
  };
}

/** The conditions runs were judged by, in the order they first come up. */
export function conditionsOf(results: RunResult[]): string[] {
  const seen = new Set<string>();
  for (const { numbers, failed } of results) {
    for (const condition of [...Object.keys(numbers), ...failed]) seen.add(condition);
  }
  return [...seen];
}

/**
 * The runs judged by some of their conditions only: a run that was solved passes when it
 * met every one of `counted`, whatever came of the others. What it did not meet is kept.
 */
export function judgedBy(results: RunResult[], counted: readonly string[]): RunResult[] {
  return results.map((result) => {
    if (result.outcome === "unsolved") return result;
    const outcome = result.failed.some((condition) => counted.includes(condition))
      ? "failed"
      : "passed";
    return outcome === result.outcome ? result : { ...result, outcome };
  });
}
