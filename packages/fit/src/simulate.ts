import {
  type Compiled,
  type Cycle,
  type Diagnostic,
  type Files,
  keepOutlines as keepModelOutlines,
  load,
  type SimulateOptions,
  type SweepRun,
  simulate as simulateModel,
  solveCycle,
  sweep as sweepModel,
} from "@mekasim/core";
import { compileFit, prepareFit } from "./compile.ts";
import {
  contactDiagnostics,
  contactResults,
  type FitCompiled,
  type FitSimulation,
} from "./contacts.ts";
import { FIT_REGISTRY } from "./registry.ts";
import { FitDocument } from "./schema.ts";
import { type Jam, solveQuasistatic } from "./solver/quasistatic.ts";

/** A cycle that remembers where its contact run stopped, for the message about it. */
type FitCycle = Cycle & { jam?: Jam };

/**
 * A model with springs or a `move` driver is solved by the contact step; any other
 * goes down mekasim's own cycle solve, contacts and `gap()` working on it all the same.
 */
function solve(compiled: Compiled): Cycle {
  const fit = compiled as FitCompiled;
  if (fit.springs.length === 0 && fit.moves.length === 0)
    return solveCycle(compiled.model, compiled.period, compiled.steps);
  const { cycle, jam } = solveQuasistatic(fit);
  return Object.assign(cycle, { jam });
}

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(files?: Files): SimulateOptions {
  return {
    schema: FitDocument,
    files,
    registry: FIT_REGISTRY,
    prepare: prepareFit,
    extend: compileFit,
    solve,
  };
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
  // In a contact run a part that no driver moves is held by its springs and by what
  // it touches, so mekasim's remark that it is not driven does not apply.
  const fit = simulation.compiled as FitCompiled | undefined;
  if (fit && (fit.springs.length > 0 || fit.moves.length > 0)) {
    const kept = simulation.diagnostics.filter(
      ({ severity, message }) => severity !== "warning" || !message.includes("of freedom"),
    );
    simulation.diagnostics.splice(0, simulation.diagnostics.length, ...kept);
  }
  const jam = (simulation.cycle as FitCycle | undefined)?.jam;
  if (jam) {
    const diagnostic = jamDiagnostic(jam);
    if (diagnostic.path) diagnostic.position = locate(diagnostic.path);
    simulation.diagnostics.push(diagnostic);
  }
  return Object.assign(simulation, { contacts, jam }) as FitSimulation;
}

function list(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

/** Why a contact run stopped, in terms of the parts that are in each other's way. */
function jamDiagnostic(jam: Jam): Diagnostic {
  const time = `${Number(jam.time.toPrecision(4))} s`;
  const pairs = new Map<string, string>();
  for (const row of jam.rows) {
    if (row.between)
      pairs.set(row.between.join("\0"), `"${row.between[0]}" against "${row.between[1]}"`);
  }
  if (pairs.size > 0) {
    return {
      severity: "error",
      message: `Jams at ${time}: ${[...pairs.values()].join(", ")}`,
      path: ["contacts", jam.rows[0]?.source as string],
    };
  }
  if (jam.open.length > 0) {
    return {
      severity: "error",
      message: `The mechanism locks up at ${time}; cannot close ${list(jam.open)}`,
    };
  }
  return { severity: "error", message: `The parts do not come to rest at ${time}` };
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
