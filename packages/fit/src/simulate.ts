import {
  type Cycle,
  type SimulateOptions,
  type Simulation,
  type SweepRun,
  simulate as simulateModel,
  sweep as sweepModel,
} from "@mekasim/core";
import { compileShapes, type FitModel } from "./compile.ts";
import type { Box, Shape } from "./geometry/shape.ts";
import { FitDocument } from "./schema.ts";

/** A solved mekafit model: mekasim's results, and what mekafit adds to them. */
export interface FitSimulation extends Simulation, FitModel {}

/** How mekafit runs mekasim's pipeline: its own schema, and what the phases add to it. */
function options(found: (model: FitModel) => void): SimulateOptions {
  return {
    schema: FitDocument,
    extend: (compiled, doc, report) => found(compileShapes(compiled, doc, report)),
  };
}

/**
 * Everything from model text to results. A model with nothing mekafit adds goes
 * down mekasim's own path and gives mekasim's numbers.
 */
export function simulate(text: string): FitSimulation {
  let model: FitModel = { shapes: new Map() };
  const simulation = simulateModel(
    text,
    options((found) => {
      model = found;
    }),
  );
  return { ...simulation, ...model };
}

/** Solve the model once for each value of a parameter, as mekasim's `sweep` does. */
export function sweep(text: string, param: string, values: number[], unit = ""): SweepRun[] {
  return sweepModel(
    text,
    param,
    values,
    unit,
    options(() => {}),
  );
}

/**
 * Everything the shapes reach over a run, added to a box: each shape taken as the
 * circle round its body's origin that holds all of it, which is quick and never too small.
 */
export function shapeBounds(
  box: Box,
  cycle: Cycle,
  bodies: Map<string, { index: number }>,
  shapes: Map<string, Shape>,
): Box {
  const out = { ...box };
  for (const [id, shape] of shapes) {
    const index = bodies.get(id)?.index;
    if (index === undefined) continue;
    const samples = index < 0 ? 1 : cycle.count;
    for (let k = 0; k < samples; k++) {
      const x = index < 0 ? 0 : (cycle.q[k * cycle.width + 3 * index] as number);
      const y = index < 0 ? 0 : (cycle.q[k * cycle.width + 3 * index + 1] as number);
      out.minX = Math.min(out.minX, x - shape.radius);
      out.maxX = Math.max(out.maxX, x + shape.radius);
      out.minY = Math.min(out.minY, y - shape.radius);
      out.maxY = Math.max(out.maxY, y + shape.radius);
    }
  }
  return out;
}
