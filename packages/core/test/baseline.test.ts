import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASELINE, type ExampleBaseline, solveExamples } from "./baseline.ts";

const stored = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, ExampleBaseline>;
const solved = solveExamples();

/** The same number, but for the last digits, which may differ from one machine to the next. */
function expectSame(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
}

describe("the examples solve to the numbers they did (run `pnpm baseline` after a change that is meant)", () => {
  it("covers every example, and no other", () => {
    expect(Object.keys(solved)).toEqual(Object.keys(stored));
  });

  for (const [file, expected] of Object.entries(stored)) {
    it(file, () => {
      const actual = solved[file] as ExampleBaseline;
      expect(actual.count).toBe(expected.count);
      expect(actual.checks).toEqual(expected.checks);
      expect(Object.keys(actual.measures)).toEqual(Object.keys(expected.measures));
      for (const [id, value] of Object.entries(expected.measures)) {
        [actual.measures[id]].flat().forEach((number, k) => {
          expectSame(number as number, [value].flat()[k] as number);
        });
      }
      expect(actual.poses.map((pose) => pose.length)).toEqual(
        expected.poses.map((pose) => pose.length),
      );
      expected.poses.forEach((pose, k) => {
        pose.forEach((number, i) => {
          expectSame(actual.poses[k]?.[i] as number, number);
        });
      });
    });
  }
});
