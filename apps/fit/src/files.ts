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
