import { editText } from "@mekasim/core";
import { drawingName, type GeometrySource } from "@mekasim/fit";

/** Files picked to open: which of them is the model, and which are drawings to go with it. */
export function sortFiles(picked: readonly (readonly [name: string, text: string])[]): {
  model?: string;
  drawings: Map<string, string>;
} {
  const drawings = new Map<string, string>();
  let model: string | undefined;
  for (const [name, text] of picked) {
    if (/\.(ya?ml|json)$/i.test(name)) model ??= text;
    else drawings.set(name, text);
  }
  return { model, drawings };
}

/**
 * The names to keep picked drawings under. A drawing goes by its own file name,
 * which is how a model finds it. When the model misses exactly one drawing and
 * exactly one was picked under another name, that one is taken to be it: a file
 * that was renamed or exported anew still lands where the model looks.
 */
export function attachAs(
  picked: ReadonlyMap<string, string>,
  missing: readonly string[],
): Map<string, string> {
  const [only] = picked;
  const [wanted] = missing;
  if (picked.size === 1 && missing.length === 1 && only && wanted && !picked.has(wanted)) {
    return new Map([[wanted, only[1]]]);
  }
  return new Map(picked);
}

/**
 * Drawings added to a model: kept as files, and those the model does not name yet
 * written into its `geometry:` section, each under a name made from its file's.
 * A text that does not read is left as it is; the files are kept all the same.
 */
export function withDrawings(
  text: string,
  sources: Readonly<Record<string, GeometrySource>>,
  missing: readonly string[],
  picked: ReadonlyMap<string, string>,
): { text: string; files: Map<string, string> } {
  const files = attachAs(picked, missing);
  const named = new Set(Object.values(sources).map((source) => source.file));
  const taken = new Set(Object.keys(sources));
  let next = text;
  for (const file of files.keys()) {
    if (named.has(file)) continue;
    const name = drawingName(file, taken);
    taken.add(name);
    try {
      next = editText(next, [{ op: "set", path: ["geometry", name], value: { file } }]);
    } catch {
      // The source has errors; the drawing waits until it is named by hand.
    }
  }
  return { text: next, files };
}
