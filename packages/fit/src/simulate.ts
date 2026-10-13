import {
  type Files,
  keepOutlines as keepModelOutlines,
  load,
  type SimulateOptions,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import {
  compileContacts,
  contactDiagnostics,
  contactResults,
  type FitSimulation,
} from "./contacts.ts";
import { FIT_REGISTRY } from "./registry.ts";
import { FitDocument } from "./schema.ts";

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(files?: Files): SimulateOptions {
  return { schema: FitDocument, files, registry: FIT_REGISTRY, extend: compileContacts };
}

/**
 * Everything from model text to results. `files` are the drawings kept beside the
 * model. A model with nothing mekafit adds goes down mekasim's own path and gives
 * mekasim's numbers.
 */
export function simulate(text: string, files?: Files): FitSimulation {
  return finish(text, simulateModel(text, options(files)));
}

/** Add mekafit's post-run messages, with their places in the source. */
function finish(text: string, simulation: SweepRun["simulation"]): FitSimulation {
  const { locate } = load(text, FitDocument);
  const contacts = contactResults(simulation);
  for (const diagnostic of contactDiagnostics(simulation, contacts)) {
    if (diagnostic.path) diagnostic.position = locate(diagnostic.path);
    simulation.diagnostics.push(diagnostic);
  }
  return Object.assign(simulation, { contacts }) as FitSimulation;
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
