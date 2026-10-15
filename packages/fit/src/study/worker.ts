import { type PreparedStudy, prepareStudy, type RunResult, runStudy } from "./run.ts";

/** What a worker that runs a study is told: first the model and the study, then runs to do. */
export type ToWorker =
  | {
      kind: "start";
      text: string;
      /** The drawings beside the model, as pairs of file name and contents. */
      files?: [string, string][];
      study: string;
      runs?: number;
    }
  | { kind: "runs"; indices: number[] };

/** What it answers: how many runs the study has, the results of a batch, or why it cannot. */
export type FromWorker =
  | { kind: "ready"; runs: number }
  | { kind: "results"; results: RunResult[] }
  | { kind: "error"; message: string };

/** How many runs a worker is given at a time. */
export const BATCH = 8;

/**
 * What a worker does with each message, the same in a browser and in Node: the model is read
 * once, then each batch of runs is solved and its results sent back without the solved motion.
 */
export function studyWorker(): (message: ToWorker) => FromWorker {
  let study: PreparedStudy | undefined;
  return (message) => {
    if (message.kind === "start") {
      const prepared = prepareStudy(
        message.text,
        message.study,
        new Map(message.files ?? []),
        message.runs,
      );
      if ("error" in prepared) return { kind: "error", message: prepared.error };
      study = prepared;
      return { kind: "ready", runs: prepared.plan.runs };
    }
    if (!study) return { kind: "error", message: "The study has not been started" };
    const prepared = study;
    return {
      kind: "results",
      results: message.indices.map((index) => {
        const { simulation: _, ...result } = runStudy(prepared, index);
        return result;
      }),
    };
  };
}

/** The run numbers 0 to `count` - 1 in batches. */
export function batches(count: number, size = BATCH): number[][] {
  const all: number[][] = [];
  for (let start = 0; start < count; start += size) {
    all.push(Array.from({ length: Math.min(size, count - start) }, (_, i) => start + i));
  }
  return all;
}
