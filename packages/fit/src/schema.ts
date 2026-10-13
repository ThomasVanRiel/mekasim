import { documentSchema } from "@mekasim/core";
import * as z from "zod";

/** The key of a mekafit model's first line, and the version it carries. */
export const FORMAT = "mekafit";
export const FORMAT_VERSION = 1;

const Id = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Names may contain letters, digits and _ and must not start with a digit",
  );

/** One named set of bodies that the model allows to touch. */
export const Contact = z.union(
  [z.strictObject({ between: z.tuple([Id, Id]) }), z.strictObject({ among: z.array(Id).min(2) })],
  { error: "A contact is between two bodies, or among a list of bodies" },
);

/**
 * A mekafit document: mekasim's, with another first line and the sections and fields
 * that `docs/mekafit/FORMAT.md` adds, as far as they are built.
 */
export const FitDocument = documentSchema({
  version: { key: FORMAT, value: FORMAT_VERSION },
  sections: { contacts: z.record(Id, Contact).optional() },
});
