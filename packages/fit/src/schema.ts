import { documentSchema } from "@mekasim/core";
import * as z from "zod";

/** The key of a mekafit model's first line, and the version it carries. */
export const FORMAT = "mekafit";
export const FORMAT_VERSION = 1;

const Expr = z.union([z.number(), z.string()]);

const Shape = z
  .strictObject({
    path: z
      .string()
      .describe(
        "Closed outlines as path text (M L H V A Z), in the body's frame and the document unit",
      ),
    holes: z
      .record(z.string(), Expr)
      .optional()
      .describe("Round holes, each at a named point of the body, with its diameter"),
  })
  .describe("The real outline of the body: one outline, with the outlines inside it cut out");

export type ShapeSource = z.infer<typeof Shape>;

/**
 * A mekafit document: mekasim's, with another first line and the sections and fields
 * that `docs/mekafit/FORMAT.md` adds, as far as they are built.
 */
export const FitDocument = documentSchema({
  version: { key: FORMAT, value: FORMAT_VERSION },
  body: { shape: Shape.optional() },
});

/** A body as mekafit reads it. */
export interface FitBody {
  shape?: ShapeSource;
}
