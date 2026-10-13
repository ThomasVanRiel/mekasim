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
