import type { RunResult, StudyPlan } from "@mekasim/fit";
import { summarize } from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import {
  applying,
  binRange,
  type Filters,
  filteredSummary,
  filterText,
  keeps,
  progressText,
  type Runs,
  rangeText,
  rateText,
  runText,
  samplingText,
  scatterView,
  unsolvedGroups,
} from "./view.ts";

const UNITS = { length: "mm", angle: "deg" } as const;
const LENGTH = [1, 0, 0, 0] as const;
const ANGLE = [0, 0, 0, 1] as const;
const DEG = Math.PI / 180;

const PLAN: StudyPlan = {
  name: "coupling",
  sample: "spread",
  runs: 4,
  seed: 1,
  varied: [
    {
      name: "side",
      dim: LENGTH,
      path: ["params", "side"],
      range: { kind: "even", from: -0.008, to: 0.008 },
    },
    {
      name: "open",
      dim: ANGLE,
      path: ["params", "open"],
      range: { kind: "pick", values: [0, 70 * DEG] },
    },
  ],
};

function result(
  index: number,
  side: number,
  open: number,
  outcome: RunResult["outcome"],
  failed: string[] = [],
): RunResult {
  return {
    index,
    values: { side, open },
    outcome,
    failed,
    numbers: {},
    ms: 1,
    ...(outcome === "unsolved" ? { message: "Cannot be put together" } : {}),
  };
}

const RESULTS = [
  result(0, -0.004, 0, "passed"),
  result(1, 0.006, 70 * DEG, "failed", ["coupled"]),
  result(2, 0.002, 0, "failed", ["closed", "coupled"]),
  result(3, 0, 70 * DEG, "unsolved"),
];

const RUNS: Runs = {
  plan: PLAN,
  results: RESULTS,
  runs: 4,
  running: false,
  complete: true,
  ms: 2400,
};

describe("a study in words", () => {
  it("tells each range and how the runs are drawn", () => {
    expect(PLAN.varied.map((varied) => rangeText(varied, UNITS))).toEqual([
      "from -8 mm to 8 mm",
      "one of 0 deg, 70 deg",
    ]);
    expect(
      rangeText(
        {
          ...(PLAN.varied[1] as StudyPlan["varied"][number]),
          range: { kind: "normal", mean: 0, spread: 1.5 * DEG },
        },
        UNITS,
      ),
    ).toBe("about 0 deg, spread 1.5 deg");
    expect(samplingText(PLAN)).toBe("4 runs, spread evenly");
    expect(samplingText({ ...PLAN, sample: "grid", runs: 1 })).toBe("1 run, every combination");
  });

  it("tells what the runs came to and how far they have gone", () => {
    expect(rateText(summarize(PLAN, RESULTS))).toBe("Passed 1 of 3: 33%, 95% range 6% to 79%");
    expect(rateText(summarize(PLAN, []))).toBe("No runs yet");
    expect(progressText(RUNS)).toBe("4 runs in 2.4 s");
    expect(progressText({ ...RUNS, running: true, complete: false, runs: 500 })).toBe(
      "4 of 500 runs",
    );
    expect(progressText({ ...RUNS, complete: false, runs: 500 })).toBe(
      "Stopped after 4 of 500 runs",
    );
    expect(runText(RESULTS[2] as RunResult, PLAN, UNITS)).toBe(
      "Run 3, failed: closed, coupled. Side 2 mm, Open 0 deg",
    );
    expect(unsolvedGroups(RESULTS)).toEqual([{ message: "Cannot be put together", indices: [3] }]);
  });
});

describe("the scatter of a study", () => {
  it("shows the runs in the model's units over the ranges, picked values moved apart a little", () => {
    const view = scatterView(RUNS, UNITS, "side", "open");
    expect(view.xLabel).toBe("Side (mm)");
    expect(view.yLabel).toBe("Open (deg)");
    expect(view.xRange).toEqual([-8, 8]);
    expect(view.yRange).toEqual([-35, 105]);
    expect(view.points.map(({ kind }) => kind)).toEqual(["passed", "failed", "failed", "unsolved"]);
    expect(view.points[0]?.x).toBeCloseTo(-4, 9);
    expect(Math.abs((view.points[1]?.y as number) - 70)).toBeLessThan(70 * 0.18);
  });

  it("puts the runs one over the other when only one parameter is varied", () => {
    const view = scatterView(RUNS, UNITS, "side", undefined);
    expect(view.yLabel).toBe("Run");
    expect(view.points.map(({ y }) => y)).toEqual([1, 2, 3, 4]);
  });

  it("leaves the runs that did not fail a chosen condition faint", () => {
    const view = scatterView(RUNS, UNITS, "side", "open", undefined, "closed");
    expect(view.points.map(({ faint }) => faint)).toEqual([true, true, false, true]);
  });

  it("adds the failures from before where they varied the same", () => {
    const before: Runs = {
      ...RUNS,
      results: [result(0, 0.001, 0, "failed", ["coupled"]), result(1, 0.001, 0, "passed")],
    };
    const view = scatterView(RUNS, UNITS, "side", "open", before);
    expect(view.points.filter(({ kind }) => kind === "before")).toHaveLength(1);
    const elsewhere: Runs = {
      ...before,
      plan: { ...PLAN, varied: [PLAN.varied[0] as StudyPlan["varied"][number]] },
    };
    expect(
      scatterView(RUNS, UNITS, "side", "open", elsewhere).points.some(
        ({ kind }) => kind === "before",
      ),
    ).toBe(false);
  });
});

describe("filtering a study's runs", () => {
  const SIDE: Filters = { side: [-0.0001, 0.008] };

  it("keeps the runs within every range", () => {
    expect(RESULTS.filter((result) => keeps(result, SIDE)).map(({ index }) => index)).toEqual([
      1, 2, 3,
    ]);
    expect(
      RESULTS.filter((result) => keeps(result, { ...SIDE, open: [0, 0] })).map(
        ({ index }) => index,
      ),
    ).toEqual([2]);
    expect(keeps(RESULTS[0] as RunResult, SIDE, "side")).toBe(true);
    expect(applying(PLAN, { ...SIDE, gone: [0, 1] })).toEqual(SIDE);
  });

  it("sums up the runs kept, and each strip over the runs the other filters keep", () => {
    const filters: Filters = { open: [0, 0] };
    const summary = filteredSummary(PLAN, RESULTS, filters);
    expect(summary.kept).toBe(2);
    expect([summary.passed, summary.failed, summary.unsolved]).toEqual([1, 1, 0]);
    const [side, open] = summary.parameters;
    // Its own strip still has both picked values, with the runs of each.
    expect(open?.bins.map(({ passed, failed }) => passed + failed)).toEqual([2, 1]);
    // The other's strip counts only the runs at 0 deg.
    expect(side?.bins.reduce((sum, { passed, failed }) => sum + passed + failed, 0)).toBe(2);
    expect(summary.failures).toEqual([
      { condition: "closed", count: 1 },
      { condition: "coupled", count: 1 },
    ]);
  });

  it("takes a range from bin to bin either way, and tells it", () => {
    const bins = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    expect(binRange(bins, 2, 0)).toEqual([0, 3]);
    expect(binRange(bins, 1, 1)).toEqual([1, 2]);
    expect(filterText(PLAN, { open: [70 * DEG, 70 * DEG], side: [0, 0.004] }, UNITS)).toBe(
      "Side from 0 mm to 4 mm, Open 70 deg",
    );
  });

  it("leaves the runs left out faint, and the earlier ones left out undrawn", () => {
    const before: Runs = { ...RUNS, results: [result(0, -0.005, 0, "failed", ["coupled"])] };
    const view = scatterView(RUNS, UNITS, "side", "open", before, undefined, SIDE);
    expect(view.points.map(({ faint }) => faint)).toEqual([true, false, false, false]);
    expect(view.points.some(({ kind }) => kind === "before")).toBe(false);
  });
});
