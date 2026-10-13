import { documentSchema, LENGTH_UNITS } from "@mekasim/core";
import * as z from "zod";

/** The key of a mekafit model's first line, and the version it carries. */
export const FORMAT = "mekafit";
export const FORMAT_VERSION = 1;

const Expr = z.union([z.number(), z.string()]);
const Holes = z
  .record(z.string(), Expr)
  .optional()
  .describe("Round holes, each at a named point of the body, with its diameter");

/** mekasim's own way of giving a shape, which mekafit reads too. */
const Written = z.strictObject({
  path: z.string().describe("Closed outlines as path text, in the body's frame"),
  holes: Holes,
});

const Drawn = z.strictObject({
  from: z.string().describe("A drawing named under geometry"),
  layer: z
    .string()
    .optional()
    .describe("The layer of the drawing the outline is on, with the outlines inside it cut out"),
  at: z
    .tuple([Expr, Expr])
    .optional()
    .describe("A point inside the wanted outline, in the drawing's coordinates"),
  place: z
    .tuple([Expr, Expr, Expr])
    .optional()
    .describe(
      "Where the body's own frame sits in the drawing, as [x, y, angle]; default [0, 0, 0]",
    ),
  holes: Holes,
});

export type ShapeFromDrawing = z.infer<typeof Drawn>;

const Geometry = z.strictObject({
  file: z.string().describe("A DXF file, kept beside the model"),
  unit: z
    .enum(LENGTH_UNITS)
    .optional()
    .describe("Length unit of the drawing, when the file does not say"),
});

export type GeometrySource = z.infer<typeof Geometry>;

/**
 * A mekafit document: mekasim's, with another first line and the sections and fields
 * that `docs/mekafit/FORMAT.md` adds, as far as they are built.
 */
export const FitDocument = documentSchema({
  version: { key: FORMAT, value: FORMAT_VERSION },
  body: {
    shape: z
      .union([Written, Drawn], {
        error: "A shape is written out as path, or taken from a drawing with from",
      })
      .optional(),
  },
  sections: {
    geometry: z
      .record(z.string(), Geometry)
      .optional()
      .describe("The drawings the model takes outlines from, kept as files beside it"),
  },
});
