// The model's motion, solved in a module worker of the browser.
import { solveMotion } from "@mekasim/fit";
import type { FromSolver, ToSolver } from "./solver.ts";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToSolver>) => void) | null;
  postMessage(message: FromSolver): void;
};
scope.onmessage = ({ data: { id, text, files } }) => {
  try {
    scope.postMessage({ id, cycle: solveMotion(text, files) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
