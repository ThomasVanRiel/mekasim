// Gathering where a study's runs touch, across Node's worker threads.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Files } from "@mekasim/core";
import { batches, type RunResult } from "@mekasim/fit";
import { emptyGrid, mergeGrid, type TouchGrid } from "./grid.ts";
import type { Part } from "./parts.ts";
import type { FromGatherer, ToGatherer } from "./worker.ts";

export interface Gathered {
  results: RunResult[];
  parts: Part[];
  /** What the runs left on each part, by its name. */
  grids: Map<string, TouchGrid>;
  threads: number;
  ms: number;
}

/**
 * Run every run of a study across worker threads, one fewer than the machine has, and
 * gather where each touched the parts. The results come in the order of their numbers;
 * `progress` hears how many are done.
 */
export async function gatherInThreads(
  text: string,
  files: Files,
  study: string,
  runs: number,
  cell: number,
  options: { threads?: number; progress?: (done: number) => void } = {},
): Promise<Gathered> {
  const start = performance.now();
  const queue = batches(runs);
  const threads = Math.max(
    1,
    Math.min(options.threads ?? availableParallelism() - 1, queue.length),
  );
  const results: RunResult[] = [];
  const grids = new Map<string, TouchGrid>();
  let parts: Part[] = [];
  const begin: ToGatherer = { kind: "start", text, files: [...files], study, runs, cell };

  await Promise.all(
    Array.from({ length: threads }, () => {
      const worker = new Worker(new URL("./node-worker.ts", import.meta.url));
      return new Promise<void>((resolve, reject) => {
        const next = (): void => {
          const indices = queue.shift();
          if (indices) worker.postMessage({ kind: "runs", indices } satisfies ToGatherer);
          else void worker.terminate().then(() => resolve());
        };
        worker.on("message", (message: FromGatherer) => {
          if (message.kind === "error") {
            void worker.terminate();
            reject(new Error(message.message));
            return;
          }
          if (message.kind === "ready") parts = message.parts;
          if (message.kind === "results") {
            results.push(...message.results);
            for (const [name, grid] of message.grids) {
              let into = grids.get(name);
              if (!into) {
                into = emptyGrid(cell);
                grids.set(name, into);
              }
              mergeGrid(into, grid);
            }
            options.progress?.(results.length);
          }
          next();
        });
        worker.on("error", reject);
        worker.postMessage(begin);
      });
    }),
  );
  results.sort((a, b) => a.index - b.index);
  return { results, parts, grids, threads, ms: performance.now() - start };
}
