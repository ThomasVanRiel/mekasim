import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";
import type { StudyPlan } from "../src/study/plan.ts";
import { normalQuantile, random, xoshiro128 } from "../src/study/random.ts";
import { prepareStudy, type RunResult, runStudy, runText } from "../src/study/run.ts";
import { drawRun } from "../src/study/sample.ts";
import { summarize, wilson } from "../src/study/stats.ts";

/** A lever pressed by a bar that comes down to `low`; it is pressed flat when the bar reaches 5 mm. */
const LEVER = `mekafit: 1
meta: { units: { length: mm, angle: deg } }
params:
  low: { value: 5 mm, min: 0 mm, max: 10 mm }
  rest: 30 deg
bodies:
  ground: { points: { O: [0, 0] } }
  lever:
    points: { O: [0, 0] }
    shape: { path: "M 0 -5 H 100 V 5 H 0 Z" }
  bar:
    points: { O: [0, 0] }
    layer: 1
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
joints:
  pin: { type: revolute, connect: [ground.O, lever.O] }
pose:
  bar: [75, 15, 0]
springs:
  up: { joint: pin, stiffness: 0.02 N*m/rad, rest: rest }
drivers:
  press:
    move: bar
    stages:
      - { to: [75, low, 0], time: 1 s }
contacts:
  touch: { between: [lever, bar] }
cycle: { steps: 20 }
checks:
  pressed_flat: min(angle(lever)) < 0.01 deg
`;

function withStudy(study: string, text = LEVER): string {
  return `${text}studies:\n${study}`;
}

function plan(study: string, text = LEVER): StudyPlan {
  const simulation = simulate(withStudy(study, text));
  const found = simulation.studies.get("s");
  if (!found) throw new Error(simulation.diagnostics.map(({ message }) => message).join("; "));
  return found;
}

function problems(study: string, text = LEVER): string[] {
  return simulate(withStudy(study, text)).diagnostics.map(({ message }) => message);
}

describe("random numbers", () => {
  it("are xoshiro128** as published", () => {
    // Its reference C code from the state 1, 2, 3, 4.
    const draw = xoshiro128([1, 2, 3, 4]);
    const first = Array.from({ length: 8 }, () => draw.next());
    expect(first).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
    ]);
  });

  it("are the same for the same keys and differ for others", () => {
    const a = Array.from({ length: 4 }, random(1, 2, 3).next);
    const b = Array.from({ length: 4 }, random(1, 2, 3).next);
    const c = Array.from({ length: 4 }, random(1, 2, 4).next);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("give uniform values in [0, 1) and normal ones with the right mean and spread", () => {
    const draw = random(7);
    let sum = 0;
    let squares = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = draw.uniform();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const x = draw.normal();
      sum += x;
      squares += x * x;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(Math.sqrt(squares / n)).toBeCloseTo(1, 1);
  });

  it("find the normal quantiles", () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 6);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 6);
    expect(normalQuantile(0.8413447460685429)).toBeCloseTo(1, 6);
  });
});

describe("a study's plan", () => {
  it("reads ranges into SI and takes a listed parameter over its bounds", () => {
    const read = plan(`  s:
    runs: 12
    seed: 4
    vary:
      low: { from: 2 mm, to: 8 mm }
      rest: { mean: 30 deg, spread: 2 deg }
`);
    expect(read.runs).toBe(12);
    expect(read.seed).toBe(4);
    expect(read.sample).toBe("spread");
    const [low, rest] = read.varied;
    expect(low?.range).toEqual({ kind: "even", from: 0.002, to: 0.008, steps: undefined });
    expect(low?.path).toEqual(["params", "low", "value"]);
    expect(rest?.range.kind).toBe("normal");
    expect(rest?.path).toEqual(["params", "rest"]);
    const listed = plan("  s: { vary: [low] }\n");
    expect(listed.runs).toBe(100);
    expect(listed.varied[0]?.range).toMatchObject({ from: 0, to: 0.01 });
  });

  it("counts every combination of a grid", () => {
    const read = plan(`  s:
    sample: grid
    runs: 5
    vary:
      low: { from: 2 mm, to: 8 mm, steps: 4 }
      rest: { pick: [20 deg, 30 deg, 40 deg] }
`);
    expect(read.runs).toBe(12);
  });

  it("tells each problem at its place", () => {
    expect(problems("  s: { vary: [rest] }\n")).toEqual([
      '"rest" has no least and most value to vary it between; give it min and max, or give the study a range for it',
    ]);
    expect(problems("  s: { vary: { width: { from: 1, to: 2 } } }\n")).toEqual([
      '"width" is not a parameter of the model',
    ]);
    expect(problems("  s: { vary: { low: { from: 2 mm, to: 12 mm } } }\n")).toEqual([
      '12 mm is above the most "low" may be, 10 mm',
    ]);
    expect(problems("  s: { vary: { low: { from: 2 deg, to: 4 deg } } }\n")).toEqual([
      'Expected a length, got an angle in "2 deg"',
      'Expected a length, got an angle in "4 deg"',
    ]);
    expect(problems("  s: { sample: grid, vary: { low: { from: 2, to: 4 } } }\n")).toEqual([
      "A grid needs `steps`: how many values to take in this range",
    ]);
    expect(problems('  s: { pass: { ok: "min(angle(lever)) <" }, vary: [low] }\n')).toHaveLength(1);
    const diagnostics = simulate(withStudy("  s: { vary: [low] }\n")).diagnostics;
    expect(diagnostics).toEqual([]);
  });

  it("warns when there is nothing to test", () => {
    const bare = LEVER.replace(/checks:\n.*\n/, "");
    expect(problems("  s: { vary: [low] }\n", bare)).toEqual([
      "This study has nothing to test, so every run that solves passes. Give the model checks, or the study pass conditions",
    ]);
  });
});

describe("drawing a study's values", () => {
  it("uses each part of every range once in a spread", () => {
    const read = plan(`  s:
    runs: 50
    vary:
      low: { from: 0 mm, to: 10 mm }
      rest: { from: 20 deg, to: 40 deg }
`);
    for (const [p, from, to] of [
      [0, 0, 0.01],
      [1, (20 * Math.PI) / 180, (40 * Math.PI) / 180],
    ] as const) {
      const bins = new Set<number>();
      for (let i = 0; i < read.runs; i++) {
        const value = drawRun(read, i)[p] as number;
        bins.add(Math.floor(((value - from) / (to - from)) * read.runs));
      }
      expect(bins.size).toBe(read.runs);
    }
  });

  it("gives run i the same values in any order and from a plan read again", () => {
    const study = `  s:
    runs: 40
    seed: 9
    vary:
      low: { from: 0 mm, to: 10 mm }
      rest: { mean: 30 deg, spread: 5 deg }
`;
    const forwards = Array.from({ length: 40 }, (_, i) => drawRun(plan(study), i));
    const again = plan(study);
    const backwards = Array.from({ length: 40 }, (_, i) => drawRun(again, 39 - i)).reverse();
    expect(backwards).toEqual(forwards);
    const other = plan(study.replace("seed: 9", "seed: 10"));
    expect(drawRun(other, 0)).not.toEqual(forwards[0]);
  });

  it("keeps normal values within the parameter's bounds", () => {
    const read = plan(`  s:
    sample: random
    runs: 200
    vary:
      low: { mean: 9 mm, spread: 3 mm }
`);
    const values = Array.from({ length: read.runs }, (_, i) => drawRun(read, i)[0] as number);
    expect(Math.max(...values)).toBeLessThanOrEqual(0.01);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(values.some((value) => value > 0.009)).toBe(true);
  });

  it("goes through a grid with the first parameter changing slowest", () => {
    const read = plan(`  s:
    sample: grid
    vary:
      low: { from: 2 mm, to: 6 mm, steps: 3 }
      rest: { pick: [20 deg, 30 deg] }
`);
    const values = Array.from({ length: read.runs }, (_, i) =>
      drawRun(read, i).map((value, p) => (p === 0 ? value * 1000 : (value * 180) / Math.PI)),
    );
    expect(values.map((pair) => pair.map((value) => Number(value.toFixed(9))))).toEqual([
      [2, 20],
      [2, 30],
      [4, 20],
      [4, 30],
      [6, 20],
      [6, 30],
    ]);
  });
});

describe("one run of a study", () => {
  const GRID = `  s:
    sample: grid
    vary:
      low: { from: 3 mm, to: 7 mm, steps: 3 }
`;

  it("writes its values into the model in its units", () => {
    const study = prepareStudy(withStudy(GRID), "s");
    if ("error" in study) throw new Error(study.error);
    expect(runText(study, [0.0045])).toContain("low: { value: 4.5 mm, min: 0 mm, max: 10 mm }");
  });

  it("passes or fails by the model's checks", () => {
    const study = prepareStudy(withStudy(GRID), "s");
    if ("error" in study) throw new Error(study.error);
    const results = [0, 1, 2].map((i) => runStudy(study, i));
    expect(results.map(({ outcome }) => outcome)).toEqual(["passed", "passed", "failed"]);
    expect(results[2]?.failed).toEqual(["pressed_flat"]);
    expect(results[2]?.numbers).toEqual({ pressed_flat: 0 });
    expect(results[0]?.values.low).toBeCloseTo(0.003, 12);
  });

  it("tests a study's own conditions in place of the checks", () => {
    const own = `${GRID}    pass:\n      deep: min(angle(lever)) < -1 deg\n`;
    const study = prepareStudy(withStudy(own), "s");
    if ("error" in study) throw new Error(study.error);
    const results = [0, 1, 2].map((i) => runStudy(study, i));
    expect(results.map(({ outcome }) => outcome)).toEqual(["passed", "failed", "failed"]);
    expect(results[1]?.failed).toEqual(["deep"]);
  });

  it("counts a run that cannot be solved apart", () => {
    const broken = `${GRID}    pass:\n      odd: nothing > 0\n`;
    const study = prepareStudy(withStudy(broken), "s");
    if ("error" in study) throw new Error(study.error);
    const result = runStudy(study, 0);
    expect(result.outcome).toBe("unsolved");
    expect(result.message).toContain("nothing");
  });

  it("says why a study cannot be run", () => {
    expect(prepareStudy(LEVER, "s")).toEqual({ error: "The model has no studies" });
    expect(prepareStudy(withStudy(GRID), "t")).toEqual({
      error: 'There is no study "t"; the model has "s"',
    });
    expect(prepareStudy(withStudy("  s: { vary: [nothing] }\n"), "s")).toEqual({
      error: '"nothing" is not a parameter of the model',
    });
  });
});

describe("what a study comes to", () => {
  it("gives the Wilson interval", () => {
    const none = wilson(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.27753, 5);
    const half = wilson(5, 10);
    expect(half.low).toBeCloseTo(0.23659, 5);
    expect(half.high).toBeCloseTo(0.76341, 5);
    const most = wilson(81, 100);
    expect(most.low).toBeCloseTo(0.72221, 5);
    expect(most.high).toBeCloseTo(0.87485, 5);
    expect(wilson(0, 0)).toEqual({ share: 0, low: 0, high: 1 });
  });

  it("finds where in its ranges a study fails", () => {
    const read = plan(`  s:
    runs: 20
    vary:
      low: { from: 0 mm, to: 10 mm }
      rest: { pick: [20 deg, 30 deg] }
`);
    // Made up: a run passes below 5 mm, whatever the rest angle, and one is not solved.
    const results = Array.from({ length: read.runs }, (_, index) => {
      const [low, rest] = drawRun(read, index) as [number, number];
      const passed = low < 0.005;
      return {
        index,
        values: { low, rest },
        outcome: index === 3 ? "unsolved" : passed ? "passed" : "failed",
        failed: passed || index === 3 ? [] : ["pressed_flat"],
        numbers: {},
        ms: 1,
      } as const;
    });
    const summary = summarize(read, [...results]);
    expect(summary.done).toBe(20);
    expect(summary.unsolved).toBe(1);
    expect(summary.passed + summary.failed).toBe(19);
    expect(summary.telling).toEqual(["low", "rest"]);
    const [low, rest] = summary.parameters;
    expect(low?.bins).toHaveLength(10);
    expect(low?.difference).toBe(1);
    expect(low?.bins.slice(0, 5).every((bin) => bin.failed === 0)).toBe(true);
    expect(rest?.bins.map(({ from }) => from)).toEqual([
      (20 * Math.PI) / 180,
      (30 * Math.PI) / 180,
    ]);
    expect(summary.failures).toEqual([{ condition: "pressed_flat", count: summary.failed }]);
  });
});

describe("pnpm fit:study", () => {
  it("runs a three-run study in worker threads and writes its runs", () => {
    const folder = mkdtempSync(join(tmpdir(), "mekafit-study-"));
    const model = join(folder, "lever.mekafit.yaml");
    const csv = join(folder, "runs.csv");
    writeFileSync(model, withStudy("  s: { vary: [low] }\n"));
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const out = execFileSync(
      process.execPath,
      [cli, "study", model, "s", "--runs", "3", "--csv", csv],
      {
        encoding: "utf8",
      },
    );
    expect(out).toContain('study "s", 3 runs');
    const rows = readFileSync(csv, "utf8").trim().split("\n");
    expect(rows[0]).toBe("run,low (mm),outcome,not met,message");
    expect(rows).toHaveLength(4);
    const study = prepareStudy(withStudy("  s: { vary: [low] }\n"), "s", undefined, 3);
    if ("error" in study) throw new Error(study.error);
    for (const [i, row] of rows.slice(1).entries()) {
      const { outcome } = runStudy(study, i);
      expect(row.split(",")[2]).toBe(outcome);
    }
    expect(out).toMatch(/Passed [0-3] of 3/);
    rmSync(folder, { recursive: true });
  });
});

describe("a grid's summary", () => {
  it("has a bin for each value the grid takes", () => {
    const read = plan(`  s:
    sample: grid
    vary:
      low: { from: 2 mm, to: 6 mm, steps: 3 }
`);
    const results = Array.from({ length: read.runs }, (_, index) => ({
      index,
      values: { low: drawRun(read, index)[0] as number },
      outcome: index < 2 ? "passed" : "failed",
      failed: index < 2 ? [] : ["pressed_flat"],
      numbers: {},
      ms: 1,
    })) as RunResult[];
    const [low] = summarize(read, results).parameters;
    expect(
      low?.bins.map(({ from, passed, failed }) => [
        Number((from * 1000).toFixed(9)),
        passed,
        failed,
      ]),
    ).toEqual([
      [2, 1, 0],
      [4, 1, 0],
      [6, 0, 1],
    ]);
  });
});
