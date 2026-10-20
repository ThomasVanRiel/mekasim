import { type PreparedStudy, prepareStudy, type RunResult, runStudy } from "@mekasim/fit";
import { runTouches } from "./gather.ts";
import { addRun, emptyGrid, type TouchGrid } from "./grid.ts";
import { type Part, partOfBody, partsOf } from "./parts.ts";

/** What a worker that gathers a study's touches is told: the model and the study, then runs. */
export type ToGatherer =
  | {
      kind: "start";
      text: string;
      /** The drawings beside the model, as pairs of file name and contents. */
      files?: [string, string][];
      study: string;
      runs?: number;
      /** The side of a cell, in metres. */
      cell: number;
    }
  | { kind: "runs"; indices: number[] };

/**
 * What it answers: the study's runs and the parts, or the results of a batch with what
 * they left on each part, or why it cannot.
 */
export type FromGatherer =
  | { kind: "ready"; runs: number; parts: Part[] }
  | { kind: "results"; results: RunResult[]; grids: Map<string, TouchGrid> }
  | { kind: "error"; message: string };

/**
 * What a worker does with each message: the model is read once, then each batch of
 * runs is solved, judged as `fit:study` judges it, and gathered onto the parts. Only
 * the cells go back, not the motion. A run that could not be solved leaves nothing.
 */
export function gatherer(): (message: ToGatherer) => FromGatherer {
  let study: PreparedStudy | undefined;
  let parts: Part[] = [];
  let partOf = new Map<string, string>();
  let cell = 0;
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
      parts = partsOf(prepared.simulation);
      partOf = partOfBody(parts);
      cell = message.cell;
      return { kind: "ready", runs: prepared.plan.runs, parts };
    }
    if (!study) return { kind: "error", message: "The study has not been started" };
    const prepared = study;
    const grids = new Map(parts.map(({ name }) => [name, emptyGrid(cell)]));
    const results = message.indices.map((index) => {
      const { simulation, ...result } = runStudy(prepared, index);
      if (result.outcome !== "unsolved") {
        for (const [part, run] of runTouches(simulation, partOf, cell)) {
          addRun(grids.get(part) as TouchGrid, run, result.outcome === "passed");
        }
      }
      return result;
    });
    return { kind: "results", results, grids };
  };
}
