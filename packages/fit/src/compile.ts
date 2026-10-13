import {
  type Compiled,
  type Diagnostic,
  type Document,
  docFactor,
  ExprError,
  evaluate,
  LENGTH,
  parseExpr,
  toSI,
} from "@mekasim/core";
import { shapeOf } from "./geometry/outline.ts";
import { OutlineError, parsePath } from "./geometry/path.ts";
import { circleLoop, type Loop, placeShape, type Shape } from "./geometry/shape.ts";
import type { FitBody } from "./schema.ts";

/** How near two places on an outline count as one, in metres. */
const TOLERANCE = 1e-9;

/** What mekafit adds to a compiled model. */
export interface FitModel {
  /** The outline of each body that has one, in metres, in the body's frame. */
  shapes: Map<string, Shape>;
}

type Report = (diagnostic: Diagnostic) => void;

/**
 * The shapes of the bodies, from what the document says beyond mekasim's. A problem
 * with a shape is reported on the line that has it, in the document's own unit.
 */
export function compileShapes(compiled: Compiled, doc: Document, report: Report): FitModel {
  const shapes = new Map<string, Shape>();
  const unit = docFactor(LENGTH, compiled.units);

  function length(source: number | string, path: (string | number)[]): number | undefined {
    try {
      const quantity = evaluate(parseExpr(String(source)), {
        units: compiled.units,
        resolve(name, node) {
          const param = compiled.params.get(name);
          if (!param) throw new ExprError(`Unknown name "${name}"`, node.pos);
          return param;
        },
      });
      const value = toSI(quantity, LENGTH, compiled.units);
      if (typeof value === "number") return value;
      throw new ExprError("This must be one value", 0);
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      report({ severity: "error", message: `${error.message} in "${source}"`, path });
      return undefined;
    }
  }

  for (const [id, body] of Object.entries(doc.bodies as Record<string, FitBody>)) {
    const source = body.shape;
    if (!source) continue;
    const at = ["bodies", id, "shape"];
    try {
      // Read and checked in the document's unit, so that a problem is told in it.
      const loops: Loop[] = parsePath(source.path);
      let sound = true;
      for (const [point, diameter] of Object.entries(source.holes ?? {})) {
        const path = [...at, "holes", point];
        const place = compiled.bodies.get(id)?.points.get(point);
        if (!place) {
          report({ severity: "error", message: `Body "${id}" has no point "${point}"`, path });
          sound = false;
          continue;
        }
        const size = length(diameter, path);
        if (size === undefined) sound = false;
        else if (size <= 0) {
          report({ severity: "error", message: "A hole's diameter must be more than zero", path });
          sound = false;
        } else loops.push(circleLoop(place.u / unit, place.v / unit, size / 2 / unit));
      }
      if (!sound) continue;
      shapes.set(id, placeShape(shapeOf(loops, TOLERANCE / unit), { scale: unit }));
    } catch (error) {
      if (!(error instanceof OutlineError)) throw error;
      report({ severity: "error", message: error.message, path: [...at, "path"] });
    }
  }
  return { shapes };
}
