import {
  type Compiled,
  type Cycle,
  type Diagnostic,
  type Files,
  GROUND,
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
import { type FitCycle, type Jam, solveQuasistatic } from "./solver/quasistatic.ts";
import { compileStudies, type StudyPlan } from "./study/plan.ts";

/**
 * A model with springs, stops, locks or a `move` driver is solved by the contact step; any other
 * goes down mekasim's own cycle solve, contacts and `gap()` working on it all the same.
 */
function byContact(fit: FitCompiled): boolean {
  return (
    fit.springs.length > 0 || fit.moves.length > 0 || fit.stops.length > 0 || fit.locks.length > 0
  );
}

function solve(compiled: Compiled): Cycle {
  const fit = compiled as FitCompiled;
  if (!byContact(fit)) return solveCycle(compiled.model, compiled.period, compiled.steps);
  const { cycle, ...found } = solveQuasistatic(fit);
  return Object.assign(cycle, found);
}

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(files?: Files, solved?: Cycle): SimulateOptions {
  return {
    schema: FitDocument,
    files,
    registry: FIT_REGISTRY,
    prepare: prepareFit,
    extend: compileFit,
    solve: solved ? () => solved : solve,
  };
}

/**
 * Everything from model text to results. `files` are the drawings kept beside the
 * model. A model with nothing mekafit adds goes down mekasim's own path and gives
 * mekasim's numbers. `solved` is the motion of this same text and files, solved
 * elsewhere (in a worker, say), taken in place of solving it again.
 */
export function simulate(text: string, files?: Files, solved?: Cycle): FitSimulation {
  return finish(text, simulateModel(text, options(files, solved)));
}

/**
 * Just the motion of a model, the slow part of `simulate`, as plain data that can be
 * sent between threads and given back to `simulate`. Undefined where it cannot be solved.
 */
export function solveMotion(text: string, files?: Files): Cycle | undefined {
  return simulateModel(text, options(files)).cycle;
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
  if (fit && byContact(fit)) {
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
  const free = (simulation.cycle as FitCycle | undefined)?.free ?? [];
  for (const { driver, time } of free) {
    const moved = fit?.moves.find((move) => move.id === driver);
    const path = ["drivers", driver];
    simulation.diagnostics.push({
      severity: "info",
      message: `"${driver}" came free at ${Number(time.toPrecision(4))} s: nothing held "${fit?.model.bodies[moved?.body ?? -1]}" against its pull`,
      path,
      position: locate(path),
    });
  }
  // A force comes from a spring or a pull; where there is neither, every force is none.
  const pushed =
    fit !== undefined &&
    (fit.springs.length > 0 ||
      fit.moves.some((move) => move.stages.some((stage) => stage.kind === "pull")));
  const { doc } = simulation;
  const asked = [
    ...Object.values(doc?.measures ?? {}),
    ...Object.values(doc?.checks ?? {}),
    ...Object.values(doc?.plots ?? {}).flat(),
  ].some((source) => /\b(force|torque)\s*\(/.test(String(source)));
  if (fit && asked && !pushed) {
    simulation.diagnostics.push({
      severity: "info",
      message:
        "Every force here is zero: nothing in the model pushes. Forces come from a spring or from a pull",
    });
  }
  // Studies are read once the model is, against its parameters; a problem in one leaves the run as it is.
  const studies = new Map<string, StudyPlan>();
  if (simulation.compiled && simulation.doc) {
    const found = compileStudies(simulation.compiled, simulation.doc, (diagnostic) => {
      if (diagnostic.path) diagnostic.position = locate(diagnostic.path);
      simulation.diagnostics.push(diagnostic);
    });
    for (const [name, plan] of found) studies.set(name, plan);
  }
  const latched = (simulation.cycle as FitCycle | undefined)?.latched ?? {};
  const loads = (simulation.cycle as FitCycle | undefined)?.loads;
  const touches = (simulation.cycle as FitCycle | undefined)?.touches ?? [];
  return Object.assign(simulation, {
    contacts,
    jam,
    free,
    latched,
    loads,
    touches,
    studies,
  }) as FitSimulation;
}

function list(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

/** Why a contact run stopped, in terms of the parts that are in each other's way. */
function jamDiagnostic(jam: Jam): Diagnostic {
  const time = `${Number(jam.time.toPrecision(4))} s`;
  const pairs = new Map<string, string>();
  for (const row of jam.rows) {
    if (!row.between) continue;
    const [first, second] = row.between;
    // A stop or a lock is told by the part it holds: the joint's second body, unless that is the ground.
    const part = second === GROUND ? first : second;
    if (row.kind === "contact") pairs.set(row.between.join("\0"), `"${first}" against "${second}"`);
    else pairs.set(`${row.kind}\0${row.source}`, `"${part}" against its ${row.kind}`);
  }
  if (pairs.size > 0) {
    return {
      severity: "error",
      message: `Jams at ${time}: ${[...pairs.values()].join(", ")}`,
      path: jamPath(jam.rows[0] as Jam["rows"][number]),
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

/** Where in the model the first thing in a jam is written. */
function jamPath(row: Jam["rows"][number]): (string | number)[] {
  if (row.kind === "stop") return ["joints", row.source, "stops"];
  return [row.kind === "lock" ? "latches" : "contacts", row.source];
}
