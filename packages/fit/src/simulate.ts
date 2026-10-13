import {
  type Files,
  keepOutlines as keepModelOutlines,
  load,
  type SimulateOptions,
  type Simulation,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import { compileContacts, contactDiagnostics } from "./contacts.ts";
import { FitDocument } from "./schema.ts";

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(files?: Files): SimulateOptions {
  return { schema: FitDocument, files, extend: compileContacts };
}

/**
 * Everything from model text to results. `files` are the drawings kept beside the
 * model. A model with nothing mekafit adds goes down mekasim's own path and gives
 * mekasim's numbers.
 */
export function simulate(text: string, files?: Files): Simulation {
  return finish(text, simulateModel(text, options(files)));
}

/** Add mekafit's post-run messages, with their places in the source. */
function finish(text: string, simulation: Simulation): Simulation {
  const { locate } = load(text, FitDocument);
  for (const diagnostic of contactDiagnostics(simulation)) {
    if (diagnostic.path) diagnostic.position = locate(diagnostic.path);
    simulation.diagnostics.push(diagnostic);
  }
  return simulation;
}

/** Solve the model once for each value of a parameter, as mekasim's `sweep` does. */
export function sweep(
  text: string,
  param: string,
  values: number[],
  unit = "",
  files?: Files,
): SweepRun[] {
  return sweepModel(text, param, values, unit, options(files)).map((run) => ({
    ...run,
    simulation: finish(text, run.simulation),
  }));
}

/** The text with the outline each body takes from a drawing kept in it, complete without its files. */
export function keepOutlines(text: string, files?: Files): string {
  return keepModelOutlines(text, files, FitDocument);
}
