import {
  ANGLE,
  type Diagnostic,
  type Document,
  docFactor,
  ExprError,
  evaluate,
  insideLoop,
  LENGTH,
  type Loop,
  loopBounds,
  parseExpr,
  placeLoop,
  startOf,
  toSI,
  UNITS,
  type Units,
  writePath,
} from "@mekasim/core";
import { readDxf } from "./import/dxf.ts";
import { chain, type Nested, nest, type OpenChain } from "./import/loops.ts";
import type { GeometrySource, ShapeFromDrawing } from "./schema.ts";

/** The drawings kept beside a model: each file's name, as the model writes it, and its text. */
export type Files = ReadonlyMap<string, string>;

/** How near two ends in a drawing count as one place, in metres. */
const JOIN = 1e-9;

/** What a drawing holds once it is read: its outlines by layer, and what there is to say about it. */
export interface Drawing {
  file: string;
  /** Metres to one unit of the drawing. Undefined when neither the file nor the model says. */
  unit?: number;
  /** Whether the unit comes from the model, the file being silent or overruled. */
  unitGiven: boolean;
  /** The closed outlines on each layer, largest first, each with its holes, in the drawing's unit. */
  layers: Map<string, Nested[]>;
  /** What does not close, by layer, with its ends. */
  open: { layer: string; chain: OpenChain }[];
  /** What was left out, by kind, and how many of each. */
  skipped: Map<string, number>;
  /** Segments drawn twice or of no length, which were dropped. */
  dropped: number;
}

/** Read a drawing into outlines. `unit` is the model's word on the unit, when it has one. */
export function readDrawing(file: string, text: string, unit?: GeometrySource["unit"]): Drawing {
  if (!/\.dxf$/i.test(file)) {
    throw new Error(`"${file}" is not a DXF file. Other drawings, such as SVG, are not read yet`);
  }
  const raw = readDxf(text);
  const metres = unit ? (UNITS[unit] as { factor: number }).factor : raw.unit;
  // Joined as finely as a nanometre, or a millionth of a unit when the unit is not known.
  const tolerance = metres ? JOIN / metres : 1e-6;
  const drawing: Drawing = {
    file,
    unit: metres,
    unitGiven: unit !== undefined,
    layers: new Map(),
    open: [],
    skipped: raw.skipped,
    dropped: 0,
  };
  for (const [layer, segments] of raw.layers) {
    const { closed, open, dropped } = chain(segments, tolerance);
    drawing.layers.set(layer, nest(closed));
    drawing.open.push(...open.map((found) => ({ layer, chain: found })));
    drawing.dropped += dropped;
  }
  return drawing;
}

type Report = (diagnostic: Diagnostic) => void;
type Path = (string | number)[];

/** A problem that is already reported. */
class Reported extends Error {}

/**
 * Put every shape that comes from a drawing into the document as mekasim writes a
 * shape: path text in the body's frame and the document's unit. The document is not
 * changed; a new one is given back, along with the drawings as they were read.
 *
 * A drawing that is not attached, or a body's outline that cannot be found in it, is
 * reported, and that body goes without its shape, so that the motion stays to be
 * seen while a drawing is being attached or put right.
 */
export function resolveShapes(
  doc: Document,
  files: Files,
  report: Report,
): { doc: Document; drawings: Map<string, Drawing> } {
  const sources = (doc as { geometry?: Record<string, GeometrySource> }).geometry ?? {};
  const units: Units = { length: "mm", angle: "deg", ...doc.meta?.units };
  const unit = docFactor(LENGTH, units);
  const drawings = new Map<string, Drawing>();

  const fail = (severity: Diagnostic["severity"], message: string, path: Path): Reported => {
    report({ severity, message, path });
    return new Reported(message);
  };

  for (const [name, source] of Object.entries(sources)) {
    const path = ["geometry", name, "file"];
    const text = files.get(source.file);
    try {
      if (text === undefined) {
        throw fail(
          "warning",
          `The drawing "${source.file}" is not attached, so the shapes from it are left out`,
          path,
        );
      }
      let drawing: Drawing;
      try {
        drawing = readDrawing(source.file, text, source.unit);
      } catch (error) {
        throw fail("error", (error as Error).message, path);
      }
      drawings.set(name, drawing);
      if (drawing.unit === undefined) {
        fail(
          "error",
          `"${source.file}" does not say what unit it is drawn in. Add it here, as in unit: mm`,
          ["geometry", name],
        );
      }
    } catch (error) {
      if (!(error instanceof Reported)) throw error;
    }
  }

  /** A number written in the model, read as a length in the drawing's unit or as an angle. */
  function number(
    source: number | string,
    kind: "length" | "angle",
    drawingUnit: number,
    path: Path,
  ): number {
    try {
      const quantity = evaluate(parseExpr(String(source)), {
        units,
        resolve(name, node) {
          throw new ExprError(
            `"${name}" cannot be used here: a place in a drawing is written in numbers`,
            node.pos,
          );
        },
      });
      if (kind === "angle") return toSI(quantity, ANGLE, units) as number;
      // Without a unit of its own it is in the drawing's coordinates; with one, it is converted to them.
      return quantity.dim.every((e) => e === 0)
        ? (quantity.value as number)
        : (toSI(quantity, LENGTH, units) as number) / drawingUnit;
    } catch (error) {
      if (error instanceof ExprError) throw fail("error", `${error.message} in "${source}"`, path);
      throw error;
    }
  }

  const bodies: Record<string, unknown> = {};
  for (const [id, body] of Object.entries(doc.bodies)) {
    const shape = body.shape as ShapeFromDrawing | { path: string } | undefined;
    if (!shape || !("from" in shape)) {
      bodies[id] = body;
      continue;
    }
    const at: Path = ["bodies", id, "shape"];
    const { shape: _, ...rest } = body;
    bodies[id] = rest;
    try {
      if (!(shape.from in sources)) {
        throw fail("error", `There is no drawing "${shape.from}" under geometry`, [...at, "from"]);
      }
      const drawing = drawings.get(shape.from);
      // Not attached, or without a unit: said once, where the drawing is named.
      if (!drawing || drawing.unit === undefined) continue;
      const drawingUnit = drawing.unit;

      let candidates: Nested[];
      if (shape.layer !== undefined) {
        const onLayer = drawing.layers.get(shape.layer);
        if (!onLayer) {
          const known = [...drawing.layers.keys()].map((layer) => `"${layer}"`).join(", ");
          throw fail(
            "error",
            `"${drawing.file}" has no layer "${shape.layer}". Its layers are ${known || "none"}`,
            [...at, "layer"],
          );
        }
        candidates = onLayer;
      } else {
        candidates = [...drawing.layers.values()].flat();
      }

      const onLayer = shape.layer === undefined ? "" : ` on layer "${shape.layer}"`;
      // An outline that does not close is not among the candidates, and is most often why one is missing.
      const loose = drawing.open.filter(
        (open) => shape.layer === undefined || open.layer === shape.layer,
      )[0];
      const unclosed = (): Reported =>
        fail(
          "error",
          `An outline${onLayer} of "${drawing.file}" is not closed: it is open between (${loose?.chain.from.join(", ")}) and (${loose?.chain.to.join(", ")})`,
          shape.layer === undefined ? at : [...at, "layer"],
        );

      let found: Nested | undefined;
      if (shape.at) {
        const x = number(shape.at[0], "length", drawingUnit, [...at, "at", 0]);
        const y = number(shape.at[1], "length", drawingUnit, [...at, "at", 1]);
        // The smallest outline round the point, should outlines lie inside each other.
        found = candidates
          .filter((outline) => insideLoop(outline.outer, x, y))
          .sort((a, b) => a.area - b.area)[0];
        if (!found) {
          if (loose) throw unclosed();
          throw fail(
            "error",
            `No closed outline${onLayer} of "${drawing.file}" has the point (${x}, ${y}) inside it`,
            [...at, "at"],
          );
        }
      } else if (candidates.length === 1) {
        found = candidates[0];
      } else if (loose) {
        throw unclosed();
      } else if (candidates.length === 0) {
        throw fail(
          "error",
          `There is no outline${onLayer} of "${drawing.file}"`,
          shape.layer === undefined ? at : [...at, "layer"],
        );
      } else {
        const where = candidates
          .slice(0, 3)
          .map(({ outer }) => {
            const [x, y] = startOf(outer.segments[0] as Loop["segments"][number]);
            return `(${Number(x.toPrecision(6))}, ${Number(y.toPrecision(6))})`;
          })
          .join(", ");
        throw fail(
          "error",
          shape.layer === undefined
            ? `"${drawing.file}" has ${candidates.length} outlines. Say which with layer, or with at: [x, y], a point inside the one that is meant`
            : `Layer "${shape.layer}" of "${drawing.file}" has ${candidates.length} outlines, at ${where}${candidates.length > 3 ? " and elsewhere" : ""}. Say which with at: [x, y], a point inside it`,
          at,
        );
      }
      if (!found) continue;

      const place = shape.place ?? [0, 0, 0];
      const px = number(place[0], "length", drawingUnit, [...at, "place", 0]);
      const py = number(place[1], "length", drawingUnit, [...at, "place", 1]);
      const angle = number(place[2], "angle", drawingUnit, [...at, "place", 2]);
      // From the drawing to the body's frame: its origin taken off, turned back, and
      // the drawing's unit changed for the document's.
      const scale = drawingUnit / unit;
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      const into = {
        scale,
        angle: -angle,
        x: -(px * cos - py * sin) * scale,
        y: -(px * sin + py * cos) * scale,
      };
      const loops = [found.outer, ...found.holes].map((loop) => placeLoop(loop, into));
      bodies[id] = {
        ...rest,
        shape: { path: writePath(loops), ...(shape.holes && { holes: shape.holes }) },
      };
    } catch (error) {
      if (!(error instanceof Reported)) throw error;
    }
  }

  const { geometry: __, ...withoutGeometry } = doc as Document & { geometry?: unknown };
  return { doc: { ...withoutGeometry, bodies } as Document, drawings };
}

/** The box round an outline of a drawing, in the drawing's unit, for showing it on its own. */
export function outlineBounds(outline: Nested): ReturnType<typeof loopBounds> {
  return loopBounds(outline.outer);
}
