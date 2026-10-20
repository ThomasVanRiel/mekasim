import type { Cycle, Files } from "@mekasim/core";

/** A model to solve the motion of, under a number that its answer comes back with. */
export interface ToSolver {
  id: number;
  text: string;
  files: Files;
}

/** The motion, or why it could not be worked out. */
export type FromSolver = { id: number; cycle?: Cycle } | { id: number; error: string };

/** What the solver needs of a worker, so that tests can hand it one that runs in place. */
export interface SolverLike {
  postMessage(message: ToSolver): void;
  onmessage: ((event: MessageEvent<FromSolver>) => void) | null;
  terminate(): void;
}

/**
 * Solves the model's motion off the page's thread, for the newest text only: asked again
 * while it is still working, it ends that work, whose answer would be out of date, and
 * starts on the new text. Only the newest request is answered.
 */
export function motionSolver(spawn: () => SolverLike): {
  solve(text: string, files: Files, done: (answer: FromSolver) => void): void;
} {
  let worker: SolverLike | undefined;
  let busy = false;
  let asked = 0;
  return {
    solve(text, files, done) {
      if (busy && worker) {
        // Nothing more is heard from it, even an answer already on its way.
        worker.onmessage = null;
        worker.terminate();
      }
      if (busy || !worker) worker = spawn();
      const id = ++asked;
      busy = true;
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        busy = false;
        done(data);
      };
      worker.postMessage({ id, text, files });
    },
  };
}
