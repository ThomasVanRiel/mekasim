import { type Dim, docFactor, type Units, unitLabel } from "@mekasim/core";
import {
  gridValue,
  type RunResult,
  type StudyPlan,
  type StudySummary,
  shownUnit,
  shownValue,
  type Varied,
} from "@mekasim/fit";
import { jitter, label, type ScatterPoint } from "@mekasim/ui";

/** What a study's runs have come to so far, as kept with them. */
export interface Runs {
  plan: StudyPlan;
  results: RunResult[];
  /** How many runs there are in all. */
  runs: number;
  running: boolean;
  complete: boolean;
  ms: number;
  error?: string;
}

/** How values of a kind are shown: the factor from SI and the unit's name. */
export function shownScale(dim: Dim, units: Units): { factor: number; label: string } {
  const unit = shownUnit(dim, units);
  if (unit) return unit;
  return { factor: docFactor(dim, units), label: unitLabel(dim, units) };
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A varied parameter's range in words. */
export function rangeText(varied: Varied, units: Units): string {
  const show = (value: number): string => shownValue(value, varied.dim, units);
  const { range } = varied;
  switch (range.kind) {
    case "even":
      return range.steps
        ? `${range.steps} steps from ${show(range.from)} to ${show(range.to)}`
        : `from ${show(range.from)} to ${show(range.to)}`;
    case "normal":
      return `about ${show(range.mean)}, spread ${show(range.spread)}`;
    case "pick":
      return `one of ${range.values.map(show).join(", ")}`;
  }
}

/** How the runs are drawn, in words. */
export function samplingText(plan: StudyPlan): string {
  if (plan.sample === "grid") return `${plural(plan.runs, "run")}, every combination`;
  const how = plan.sample === "spread" ? "spread evenly" : "at random";
  return `${plural(plan.runs, "run")}, ${how}`;
}

/** The share passed and its range, or that nothing has been solved yet. */
export function rateText(summary: StudySummary): string {
  const solved = summary.passed + summary.failed;
  if (solved === 0) return summary.done > 0 ? "No run could be solved" : "No runs yet";
  const { rate } = summary;
  return `Passed ${summary.passed} of ${solved}: ${percent(rate.share)}, 95% range ${percent(rate.low)} to ${percent(rate.high)}`;
}

/** Just the share and its range, as for the runs before. */
export function shortRate(summary: StudySummary): string {
  const { rate } = summary;
  return summary.passed + summary.failed === 0
    ? "nothing solved"
    : `${percent(rate.share)} (${percent(rate.low)} to ${percent(rate.high)})`;
}

/** How far the runs have gone. */
export function progressText(runs: Runs): string {
  const done = runs.results.length;
  const seconds = Number((runs.ms / 1000).toPrecision(2));
  if (runs.error) return runs.error;
  if (runs.running) return `${done} of ${plural(runs.runs, "run")}`;
  if (runs.complete) return `${plural(done, "run")} in ${seconds} s`;
  return `Stopped after ${done} of ${plural(runs.runs, "run")}`;
}

/** One run in words: its number, outcome and values. */
export function runText(result: RunResult, plan: StudyPlan, units: Units): string {
  const outcome =
    result.outcome === "passed"
      ? "passed"
      : result.outcome === "failed"
        ? `failed: ${result.failed.join(", ") || "jammed"}`
        : "could not be solved";
  const values = plan.varied
    .map(
      ({ name, dim }) => `${label(name)} ${shownValue(result.values[name] as number, dim, units)}`,
    )
    .join(", ");
  return `Run ${result.index + 1}, ${outcome}. ${values}`;
}

/** One axis of the scatter: what it shows and how far it goes, in shown units. */
interface Axis {
  label: string;
  range?: [number, number];
  /** The value of a run on it. */
  value(result: RunResult): number;
}

function axisOf(plan: StudyPlan, name: string | undefined, units: Units): Axis {
  const varied = plan.varied.find((each) => each.name === name);
  if (!varied) {
    // With one parameter alone, the runs stand one above the other by their numbers.
    return {
      label: "Run",
      range: [1, Math.max(plan.runs, 2)],
      value: (result) => result.index + 1,
    };
  }
  const { factor, label: unit } = shownScale(varied.dim, units);
  const shown = (value: number): number => value / factor;
  const title = unit ? `${label(varied.name)} (${unit})` : label(varied.name);
  const { range } = varied;
  if (range.kind === "even" && !range.steps) {
    return {
      label: title,
      range: [shown(range.from), shown(range.to)],
      value: (r) => shown(r.values[varied.name] as number),
    };
  }
  if (range.kind !== "normal") {
    // A few values only: the runs at each are moved apart a little to be seen.
    const taken =
      range.kind === "pick"
        ? range.values
        : Array.from({ length: range.steps ?? 1 }, (_, k) =>
            gridValue(range.from, range.to, range.steps ?? 1, k),
          );
    const values = [...new Set(taken.map(shown))].sort((a, b) => a - b);
    const gaps = values.slice(1).map((value, i) => value - (values[i] as number));
    const gap = gaps.length > 0 ? Math.min(...gaps) : 1;
    return {
      label: title,
      range: [(values[0] ?? 0) - gap / 2, (values.at(-1) ?? 0) + gap / 2],
      value: (r) => shown(r.values[varied.name] as number) + jitter(r.index, gap),
    };
  }
  return { label: title, value: (r) => shown(r.values[varied.name] as number) };
}

export interface ScatterView {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xRange?: [number, number];
  yRange?: [number, number];
}

/**
 * The runs over two parameters: this study's runs, and the failures of the runs before
 * where they varied the same two. With `only` a condition, the runs that did not fail it
 * are faint.
 */
export function scatterView(
  now: Runs,
  units: Units,
  x: string | undefined,
  y: string | undefined,
  before?: Runs,
  only?: string,
): ScatterView {
  const xAxis = axisOf(now.plan, x, units);
  const yAxis = axisOf(now.plan, y, units);
  const points: ScatterPoint[] = now.results.map((result) => ({
    key: result.index,
    x: xAxis.value(result),
    y: yAxis.value(result),
    kind: result.outcome,
    faint: only !== undefined && !result.failed.includes(only),
  }));
  const varies = (plan: StudyPlan, name?: string): boolean =>
    name === undefined || plan.varied.some((each) => each.name === name);
  if (before && varies(before.plan, x) && varies(before.plan, y)) {
    for (const result of before.results) {
      if (result.outcome !== "failed") continue;
      if (x !== undefined && result.values[x] === undefined) continue;
      if (y !== undefined && result.values[y] === undefined) continue;
      points.push({
        key: result.index,
        x: xAxis.value(result),
        y: yAxis.value(result),
        kind: "before",
      });
    }
  }
  return {
    points,
    xLabel: xAxis.label,
    yLabel: yAxis.label,
    xRange: xAxis.range,
    yRange: yAxis.range,
  };
}

/** The runs that could not be solved, by what was said of them. */
export function unsolvedGroups(results: RunResult[]): { message: string; indices: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const { outcome, message, index } of results) {
    if (outcome !== "unsolved") continue;
    const key = message ?? "";
    groups.set(key, [...(groups.get(key) ?? []), index]);
  }
  return [...groups].map(([message, indices]) => ({
    message,
    indices: indices.sort((a, b) => a - b),
  }));
}
