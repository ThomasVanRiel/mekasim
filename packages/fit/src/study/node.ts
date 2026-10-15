// Running a study's runs in Node's worker threads, for the command line and its tests.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Files } from "@mekasim/core";
import type { RunResult } from "./run.ts";
import { batches, type FromWorker, type ToWorker } from "./worker.ts";

export interface StudyRun {
  results: RunResult[];
  threads: number;
  ms: number;
}

/**
 * Run every run of a study across worker threads, one fewer than the machine has, and give the
 * results in the order of their numbers. `progress` hears how many are done.
 */
export async function runInThreads(
  text: string,
  files: Files,
  study: string,
  runs: number,
  options: { threads?: number; progress?: (done: number) => void } = {},
): Promise<StudyRun> {
  const start = performance.now();
  const queue = batches(runs);
  const threads = Math.max(
    1,
    Math.min(options.threads ?? availableParallelism() - 1, queue.length),
  );
  const results: RunResult[] = [];
  const begin: ToWorker = { kind: "start", text, files: [...files], study, runs };

  await Promise.all(
    Array.from({ length: threads }, () => {
      const worker = new Worker(new URL("./node-worker.ts", import.meta.url));
      return new Promise<void>((resolve, reject) => {
        const next = (): void => {
          const indices = queue.shift();
          if (indices) worker.postMessage({ kind: "runs", indices } satisfies ToWorker);
          else void worker.terminate().then(() => resolve());
        };
        worker.on("message", (message: FromWorker) => {
          if (message.kind === "error") {
            void worker.terminate();
            reject(new Error(message.message));
            return;
          }
          if (message.kind === "results") {
            results.push(...message.results);
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
  return { results, threads, ms: performance.now() - start };
}
