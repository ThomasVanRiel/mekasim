import { type Loaded, load as loadModel } from "@mekasim/core";
import { FitDocument } from "./schema.ts";

/** Parse and validate the text of a mekafit model, or of a mekasim model as it is. */
export function load(text: string): Loaded {
  return loadModel(text, FitDocument);
}

/**
 * The text as a mekasim model, when it holds nothing that mekasim lacks: as it is,
 * or with its first line changed. Undefined when it is a mekafit model in more than
 * that line, or does not read at all.
 */
export function asMekasim(text: string): string | undefined {
  if (load(text).doc === undefined) return undefined;
  const plain = text.replace(/^mekafit(\s*:\s*)1\b/m, "mekasim$11");
  return loadModel(plain).doc === undefined ? undefined : plain;
}
