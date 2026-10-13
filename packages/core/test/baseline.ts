import { readdirSync, readFileSync } from "node:fs";
import { simulate } from "../src/simulate.ts";

/** What one example solves to: enough to tell that a change left its motion alone. */
export interface ExampleBaseline {
  /** Samples solved. */
  count: number;
  /** Each measure: its value, or the first, middle and last sample of one that varies. */
  measures: Record<string, number | number[]>;
  /** Whether each check is met. */
  checks: Record<string, boolean>;
  /** The coordinates of all moving bodies at the first, middle and last sample. */
  poses: number[][];
}

export const EXAMPLES = new URL("../../../examples/", import.meta.url);
export const BASELINE = new URL("./baseline.json", import.meta.url);

/** The first, middle and last of a number of samples. */
function three(count: number): number[] {
  return [0, Math.floor(count / 2), count - 1];
}

/** Every example in `examples/`, by file name, solved as the app solves it. */
export function solveExamples(): Record<string, ExampleBaseline> {
  const result: Record<string, ExampleBaseline> = {};
  for (const file of readdirSync(EXAMPLES).sort()) {
    if (!file.endsWith(".mekasim.yaml")) continue;
    const { cycle, measures, checks } = simulate(readFileSync(new URL(file, EXAMPLES), "utf8"));
    if (!cycle) throw new Error(`${file} does not solve`);
    const at = three(cycle.count);
    result[file] = {
      count: cycle.count,
      measures: Object.fromEntries(
        measures.flatMap(({ id, quantity }) => {
          if (!quantity) return [];
          const { value } = quantity;
          return [[id, typeof value === "number" ? value : at.map((k) => value[k] as number)]];
        }),
      ),
      checks: Object.fromEntries(
        checks.flatMap(({ id, holds }) => (holds === undefined ? [] : [[id, holds]])),
      ),
      poses: at.map((k) => Array.from(cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width))),
    };
  }
  return result;
}
