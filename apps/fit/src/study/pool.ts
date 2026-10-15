import { batches, type FromWorker, type RunResult, type ToWorker } from "@mekasim/fit";

/** What the pool needs of a worker, so that tests can hand it one that runs in place. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  terminate(): void;
}

export interface PoolEvents {
  /** Results of a batch, as they come. */
  results(results: RunResult[]): void;
  /** Every run is done. */
  done(): void;
  /** The study cannot be run; the workers are ended. */
  error(message: string): void;
}

/** How many workers to start: one fewer than the machine has threads, at least one. */
export function workerCount(threads: number | undefined): number {
  return Math.max(1, (threads ?? 2) - 1);
}

/**
 * Run a study's `runs` runs across `count` workers, giving each a batch of run numbers
 * at a time. `stop` ends the workers and keeps what has come back.
 */
export function startPool(
  start: Extract<ToWorker, { kind: "start" }>,
  runs: number,
  count: number,
  spawn: () => WorkerLike,
  events: PoolEvents,
): { stop(): void } {
  const queue = batches(runs);
  const workers: WorkerLike[] = [];
  let busy = 0;
  let over = false;

  function end(): void {
    over = true;
    for (const worker of workers) worker.terminate();
  }

  function feed(worker: WorkerLike): void {
    const indices = queue.shift();
    if (indices) {
      busy++;
      worker.postMessage({ kind: "runs", indices });
    } else if (busy === 0 && !over) {
      end();
      events.done();
    }
  }

  for (let i = 0; i < Math.min(count, queue.length); i++) {
    const worker = spawn();
    workers.push(worker);
    worker.onmessage = ({ data }) => {
      if (over) return;
      if (data.kind === "error") {
        end();
        events.error(data.message);
        return;
      }
      if (data.kind === "results") {
        busy--;
        events.results(data.results);
      }
      feed(worker);
    };
    worker.postMessage(start);
  }
  if (queue.length === 0) {
    over = true;
    events.done();
  }
  return { stop: end };
}
