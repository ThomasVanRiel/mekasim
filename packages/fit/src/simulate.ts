import {
  type Files,
  keepOutlines as keepModelOutlines,
  type SimulateOptions,
  type Simulation,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import { FitDocument } from "./schema.ts";

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(files?: Files): SimulateOptions {
  return { schema: FitDocument, files };
}

/**
 * Everything from model text to results. `files` are the drawings kept beside the
 * model. A model with nothing mekafit adds goes down mekasim's own path and gives
 * mekasim's numbers.
 */
export function simulate(text: string, files?: Files): Simulation {
  return simulateModel(text, options(files));
}

/** Solve the model once for each value of a parameter, as mekasim's `sweep` does. */
export function sweep(
  text: string,
  param: string,
  values: number[],
  unit = "",
  files?: Files,
): SweepRun[] {
  return sweepModel(text, param, values, unit, options(files));
}

/** The text with the outline each body takes from a drawing kept in it, complete without its files. */
export function keepOutlines(text: string, files?: Files): string {
  return keepModelOutlines(text, files, FitDocument);
}
