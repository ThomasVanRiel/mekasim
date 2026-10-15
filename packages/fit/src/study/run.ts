import { type Diagnostic, type Edit, editText, type Files } from "@mekasim/core";
import type { FitSimulation } from "../contacts.ts";
import { simulate } from "../simulate.ts";
import { type StudyPlan, writtenValue } from "./plan.ts";
import { drawRun } from "./sample.ts";

export type Outcome = "passed" | "failed" | "unsolved";

/** What one run of a study came to. */
export interface RunResult {
  index: number;
  /** The varied parameters' values, in SI. */
  values: Record<string, number>;
  outcome: Outcome;
  /** The conditions that were not met. */
  failed: string[];
  /** Why a run could not be solved; for one that jammed, where. */
  message?: string;
  /** Each condition as 1 where it is met, 0 where not. */
  numbers: Record<string, number>;
  /** How long the run took. */
  ms: number;
}

/** A study ready to run: its plan, and the model it edits for each run. */
export interface PreparedStudy {
  plan: StudyPlan;
  /** The model text with the study's `pass` conditions in place of its checks. */
  text: string;
  files?: Files;
  /** The model's own result, before anything is varied. */
  simulation: FitSimulation;
}

/**
 * Read a model and pick one of its studies, with `runs` in place of its own number of runs
 * when given (a grid keeps its count). A model that does not solve, or a study that is
 * missing or has a problem, gives the reason instead.
 */
export function prepareStudy(
  text: string,
  name: string,
  files?: Files,
  runs?: number,
): PreparedStudy | { error: string } {
  return studyOf(text, simulate(text, files), name, files, runs);
}

/** `prepareStudy` for a model already solved: `simulation` is what `text` solves to. */
export function studyOf(
  text: string,
  simulation: FitSimulation,
  name: string,
  files?: Files,
  runs?: number,
): PreparedStudy | { error: string } {
  const found = simulation.studies.get(name);
  const plan = found && runs !== undefined && found.sample !== "grid" ? { ...found, runs } : found;
  if (!plan) {
    const problem = simulation.diagnostics.find(({ severity }) => severity === "error");
    if (problem) return { error: problem.message };
    const known = [...simulation.studies.keys()].map((id) => `"${id}"`).join(", ");
    return {
      error: known
        ? `There is no study "${name}"; the model has ${known}`
        : "The model has no studies",
    };
  }
  // The study's conditions take the place of the model's checks, so they are tested by the same code.
  const tested = plan.pass
    ? editText(text, [{ op: "set", path: ["checks"], value: plan.pass }])
    : text;
  return { plan, text: tested, files, simulation };
}

/** The model text of one run: its values written into the parameters. */
export function runText(study: PreparedStudy, values: number[]): string {
  const { units } = study.simulation.compiled as NonNullable<FitSimulation["compiled"]>;
  const edits: Edit[] = study.plan.varied.map(({ path, dim }, p) => ({
    op: "set",
    path,
    value: writtenValue(values[p] as number, dim, units),
  }));
  return editText(study.text, edits);
}

/** Whether a problem in a run's result means it was not solved, rather than that it failed. */
function unsolvedBy(simulation: FitSimulation): Diagnostic | undefined {
  // Parts that jam against each other are an outcome of the mechanism, which its conditions judge.
  const jammed = simulation.jam?.rows.some((row) => row.between) ?? false;
  return simulation.diagnostics.find(
    ({ severity, message }) => severity === "error" && !(jammed && message.startsWith("Jams at")),
  );
}

/** What run `index` of the study comes to, judged as the model's checks are. */
export function judge(
  index: number,
  values: number[],
  study: PreparedStudy,
  simulation: FitSimulation,
): Omit<RunResult, "ms"> {
  const named = Object.fromEntries(
    study.plan.varied.map(({ name }, p) => [name, values[p] as number]),
  );
  const problem = unsolvedBy(simulation);
  if (problem) {
    return {
      index,
      values: named,
      outcome: "unsolved",
      failed: [],
      message: problem.message,
      numbers: {},
    };
  }
  const numbers: Record<string, number> = {};
  const failed: string[] = [];
  for (const { id, holds } of simulation.checks) {
    numbers[id] = holds ? 1 : 0;
    if (!holds) failed.push(id);
  }
  const jam = simulation.diagnostics.find(({ message }) => message.startsWith("Jams at"));
  return {
    index,
    values: named,
    outcome: failed.length > 0 ? "failed" : "passed",
    failed,
    ...(jam ? { message: jam.message } : {}),
    numbers,
  };
}

/** Solve run `index` of a study and judge it. */
export function runStudy(
  study: PreparedStudy,
  index: number,
): RunResult & { simulation: FitSimulation } {
  const start = performance.now();
  const values = drawRun(study.plan, index);
  const simulation = simulate(runText(study, values), study.files);
  const result = judge(index, values, study, simulation);
  return { ...result, ms: performance.now() - start, simulation };
}
