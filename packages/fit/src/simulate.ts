import {
  type Document,
  editText,
  type SimulateOptions,
  type Simulation,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import { type Drawing, type Files, resolveShapes } from "./files.ts";
import { load } from "./load.ts";
import { FitDocument } from "./schema.ts";

const NO_FILES: Files = new Map();

/** A solved mekafit model: mekasim's results, and the drawings it took outlines from. */
export interface FitSimulation extends Simulation {
  /** The drawings named under `geometry` that were attached, by that name. */
  drawings: Map<string, Drawing>;
}

/** How mekafit runs mekasim's pipeline: its own schema, and its shapes put in mekasim's words. */
function options(files: Files, found?: (drawings: Map<string, Drawing>) => void): SimulateOptions {
  return {
    schema: FitDocument,
    prepare(doc, report) {
      const resolved = resolveShapes(doc, files, report);
      found?.(resolved.drawings);
      return resolved.doc;
    },
  };
}

/**
 * Everything from model text to results. `files` are the drawings kept beside the
 * model. A model with nothing mekafit adds goes down mekasim's own path and gives
 * mekasim's numbers.
 */
export function simulate(text: string, files: Files = NO_FILES): FitSimulation {
  let drawings = new Map<string, Drawing>();
  const simulation = simulateModel(
    text,
    options(files, (found) => {
      drawings = found;
    }),
  );
  return { ...simulation, drawings };
}

/** Solve the model once for each value of a parameter, as mekasim's `sweep` does. */
export function sweep(
  text: string,
  param: string,
  values: number[],
  unit = "",
  files: Files = NO_FILES,
): SweepRun[] {
  return sweepModel(text, param, values, unit, options(files));
}

/**
 * The model's text with every shape that comes from a drawing written out as path
 * text, and `geometry` gone: complete without its files, for a link, and a mekasim
 * model when nothing else of mekafit's is in it. The rest of the text is left as
 * written. Undefined when the text does not read.
 */
export function flatten(text: string, files: Files = NO_FILES): string | undefined {
  const loaded = load(text);
  if (!loaded.doc) return undefined;
  const { doc } = resolveShapes(loaded.doc, files, () => {});
  const before = loaded.doc as Document & { geometry?: unknown };
  const edits: Parameters<typeof editText>[1] = [];
  for (const [id, body] of Object.entries(before.bodies)) {
    const shape = body.shape as { from?: string } | undefined;
    if (!shape || !("from" in shape)) continue;
    const written = doc.bodies[id]?.shape;
    edits.push(
      written
        ? { op: "set", path: ["bodies", id, "shape"], value: written as never }
        : { op: "delete", path: ["bodies", id, "shape"] },
    );
  }
  if (before.geometry !== undefined) edits.push({ op: "delete", path: ["geometry"] });
  return edits.length === 0 ? text : editText(text, edits);
}
