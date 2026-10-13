import { documentSchema } from "@mekasim/core";

/** The key of a mekafit model's first line, and the version it carries. */
export const FORMAT = "mekafit";
export const FORMAT_VERSION = 1;

/**
 * A mekafit document: mekasim's, with another first line and, as the phases are
 * built, the sections and fields that `docs/mekafit/FORMAT.md` adds.
 */
export const FitDocument = documentSchema({ version: { key: FORMAT, value: FORMAT_VERSION } });
