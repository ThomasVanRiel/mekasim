import {
  type SimulateOptions,
  type Simulation,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import { FitDocument } from "./schema.ts";

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
export const OPTIONS: SimulateOptions = { schema: FitDocument };

/**
 * Everything from model text to results. A model with nothing mekafit adds goes
 * down mekasim's own path and gives mekasim's numbers.
 */
export function simulate(text: string): Simulation {
  return simulateModel(text, OPTIONS);
}

/** Solve the model once for each value of a parameter, as mekasim's `sweep` does. */
export function sweep(text: string, param: string, values: number[], unit = ""): SweepRun[] {
  return sweepModel(text, param, values, unit, OPTIONS);
}
