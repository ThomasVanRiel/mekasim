import type { Files } from "@mekasim/core";
import {
  type FitSimulation,
  type RunResult,
  runStudy,
  type StudyPlan,
  studyOf,
} from "@mekasim/fit";

export interface Replayed {
  simulation: FitSimulation;
  result: Omit<RunResult, "ms">;
  /** Whether it came to what the study had counted for it. */
  matches: boolean;
}

/**
 * Solve one run of a study again, from the model as `text` has it, to show it. The values
 * are drawn as the study drew them; a run that does not come to its counted outcome is a bug.
 */
export function replayRun(
  text: string,
  simulation: FitSimulation,
  files: Files,
  plan: StudyPlan,
  counted: RunResult,
): Replayed | { error: string } {
  const study = studyOf(text, simulation, plan.name, files, plan.runs);
  if ("error" in study) return study;
  const { simulation: solved, ms: _, ...result } = runStudy(study, counted.index);
  const matches =
    result.outcome === counted.outcome &&
    result.failed.join("\0") === counted.failed.join("\0") &&
    Object.entries(counted.values).every(([name, value]) => result.values[name] === value);
  return { simulation: solved, result, matches };
}
