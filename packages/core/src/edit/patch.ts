import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parse,
  parseDocument,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
  type Document as YamlDocument,
} from "yaml";

/**
 * Changes to model text that leave everything else in it untouched: comments,
 * spacing and the order of entries stay as the author wrote them. A change is made
 * by rewriting only the affected characters; if that cannot be done cleanly, the
 * document is re-serialised instead, which keeps comments but not spacing.
 */

export type Path = (string | number)[];
export type Value = number | string | boolean | null | Value[] | { [key: string]: Value };

export type Edit =
  /**
   * Create or replace the value at `path`. `block` is how many levels of a new map
   * are written one entry per line; deeper levels are written inline as `{ ... }`.
   */
  { op: "set"; path: Path; value: Value; block?: number } | { op: "delete"; path: Path };

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/** Raised when a change cannot be made by rewriting characters in place. */
class Unsupported extends Error {}

type Range = [number, number, number];

function rangeOf(node: unknown): Range {
  if (isNode(node) && node.range) return node.range as Range;
  throw new Unsupported();
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end < 0 ? text.length : end;
}

function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function isObject(value: Value): value is { [key: string]: Value } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(node: unknown): boolean {
  return node === null || node === undefined || (isScalar(node) && node.value === null);
}

function keyOf(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

/** A scalar written without quotes where YAML reads it back unchanged, quoted otherwise. */
function scalarText(value: number | string | boolean | null, flow: boolean): string {
  if (typeof value !== "string") return String(value);
  if (value !== "" && !value.includes("\n")) {
    try {
      const back: unknown = flow
        ? (parse(`[${value}]`) as unknown[])
        : (parse(`k: ${value}`) as { k: unknown }).k;
      const same = flow
        ? Array.isArray(back) && back.length === 1 && back[0] === value
        : back === value;
      if (same) return value;
    } catch {
      // Not valid as a plain scalar; quote it.
    }
  }
  return JSON.stringify(value);
}

/** A value written inline: `[1, 2]`, `{ a: 1 }`. */
function flowText(value: Value, nested = false): string {
  if (Array.isArray(value)) return `[${value.map((item) => flowText(item, true)).join(", ")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${scalarText(key, true)}: ${flowText(item, true)}`,
    );
    return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
  }
  return scalarText(value, nested);
}

/** Lines for `key: value`, with `block` levels of maps written one entry per line. */
function blockLines(key: string, value: Value, indent: number, block: number): string[] {
  const pad = " ".repeat(indent);
  const name = scalarText(key, false);
  if (isObject(value) && block > 0 && Object.keys(value).length > 0) {
    return [
      `${pad}${name}:`,
      ...Object.entries(value).flatMap(([k, v]) => blockLines(k, v, indent + 2, block - 1)),
    ];
  }
  return [`${pad}${name}: ${flowText(value)}`];
}

function container(doc: YamlDocument, path: Path): unknown {
  return path.length === 0 ? doc.contents : doc.getIn(path, true);
}

function pairAt(doc: YamlDocument, path: Path): Pair | undefined {
  const parent = container(doc, path.slice(0, -1));
  if (!isMap(parent)) return undefined;
  const key = String(path.at(-1));
  return parent.items.find((pair) => keyOf(pair) === key);
}

/** Offset just past a pair's value, or past its colon when it has none. */
function pairEnd(text: string, pair: Pair): number {
  if (isEmptyValue(pair.value)) return text.indexOf(":", rangeOf(pair.key)[1]) + 1;
  // A map written in lines reports an end that runs on into the blank lines after it.
  let end = rangeOf(pair.value)[1];
  while (end > 0 && /\s/.test(text[end - 1] as string)) end--;
  return end;
}

/** Give a key that has no value, or an empty `{}`, its first content. */
function fill(text: string, pair: Pair, value: Value, block: number): string {
  const key = rangeOf(pair.key);
  const colon = text.indexOf(":", key[1]);
  if (colon < 0) throw new Unsupported();
  const end = isEmptyValue(pair.value) ? colon + 1 : rangeOf(pair.value)[1];
  if (isObject(value) && block > 0 && Object.keys(value).length > 0) {
    const indent = column(text, key[0]) + 2;
    const lines = Object.entries(value).flatMap(([k, v]) => blockLines(k, v, indent, block - 1));
    const head = text.slice(0, colon + 1) + text.slice(end);
    const eol = lineEnd(head, colon);
    return `${head.slice(0, eol)}\n${lines.join("\n")}${head.slice(eol)}`;
  }
  return `${text.slice(0, colon + 1)} ${flowText(value)}${text.slice(end)}`;
}

function insertIntoBlockMap(
  text: string,
  map: YAMLMap,
  key: string,
  value: Value,
  block: number,
  topLevel: boolean,
  order: string[],
): string {
  const first = map.items[0] as Pair;
  const indent = column(text, rangeOf(first.key)[0]);
  // New entries go last, except top-level sections, which keep their usual order.
  let after = map.items.at(-1) as Pair;
  const rank = order.indexOf(key);
  if (topLevel && rank >= 0) {
    const earlier = map.items.filter((pair) => {
      const other = order.indexOf(keyOf(pair));
      return other >= 0 && other < rank;
    });
    const later = map.items.some((pair) => order.indexOf(keyOf(pair)) > rank);
    if (later && earlier.length > 0) after = earlier.at(-1) as Pair;
  }
  const at = lineEnd(text, pairEnd(text, after));
  // Top-level sections are set off by a blank line.
  const lines = blockLines(key, value, indent, block);
  const gap = topLevel ? "\n" : "";
  return `${text.slice(0, at)}\n${gap}${lines.join("\n")}${text.slice(at)}`;
}

function set(
  text: string,
  doc: YamlDocument,
  path: Path,
  value: Value,
  block: number,
  order: string[],
): string {
  if (path.length === 0) throw new Unsupported();
  const key = path.at(-1) as string | number;
  const parentPath = path.slice(0, -1);
  const parent = container(doc, parentPath);
  const existing = doc.getIn(path, true);

  if (existing !== undefined) {
    const pair = pairAt(doc, path);
    const emptyFlow =
      (isMap(existing) || isSeq(existing)) && existing.flow === true && existing.items.length === 0;
    if (pair && (isEmptyValue(existing) || emptyFlow)) return fill(text, pair, value, block);
    const inline = isScalar(existing) || ((isMap(existing) || isSeq(existing)) && existing.flow);
    if (!inline || (isObject(value) && block > 0)) throw new Unsupported();
    const [start, end] = rangeOf(existing);
    return (
      text.slice(0, start) + flowText(value, isSeq(parent) || isFlow(parent)) + text.slice(end)
    );
  }

  if (isEmptyValue(parent)) {
    // The parent is missing too: create it around the new value.
    return set(text, doc, parentPath, { [String(key)]: value }, block + 1, order);
  }

  if (isMap(parent)) {
    if (parent.items.length === 0) {
      // An empty `{}` becomes one entry per line where the entry itself wants lines,
      // and for top-level sections, which are always written that way.
      const lines = block > 0 || parentPath.length === 1;
      return set(text, doc, parentPath, { [String(key)]: value }, lines ? block + 1 : 0, order);
    }
    if (parent.flow) {
      const at = pairEnd(text, parent.items.at(-1) as Pair);
      const entry = `, ${scalarText(String(key), true)}: ${flowText(value, true)}`;
      return text.slice(0, at) + entry + text.slice(at);
    }
    return insertIntoBlockMap(
      text,
      parent,
      String(key),
      value,
      block,
      parentPath.length === 0,
      order,
    );
  }

  if (isSeq(parent) && key === parent.items.length) return appendToSeq(text, parent, value);
  throw new Unsupported();
}

function isFlow(node: unknown): boolean {
  return (isMap(node) || isSeq(node)) && node.flow === true;
}

function appendToSeq(text: string, seq: YAMLSeq, value: Value): string {
  const last = seq.items.at(-1);
  if (seq.flow) {
    if (!last) {
      const [start, end] = rangeOf(seq);
      return `${text.slice(0, start)}[${flowText(value, true)}]${text.slice(end)}`;
    }
    const at = rangeOf(last)[1];
    return `${text.slice(0, at)}, ${flowText(value, true)}${text.slice(at)}`;
  }
  if (!last) throw new Unsupported();
  const start = rangeOf(last)[0];
  const dash = text.lastIndexOf("-", start);
  if (dash < lineStart(text, start)) throw new Unsupported();
  const at = lineEnd(text, rangeOf(last)[1]);
  return `${text.slice(0, at)}\n${" ".repeat(column(text, dash))}- ${flowText(value)}${text.slice(at)}`;
}

/** Remove whole lines `[from, to]`, where `to` is the end of the last line's content. */
function removeLines(text: string, from: number, to: number): string {
  const start = lineStart(text, from);
  if (text.slice(start, from).trim() !== "" && text.slice(start, from).trim() !== "-") {
    throw new Unsupported();
  }
  const end = lineEnd(text, to);
  let result: string;
  if (end < text.length) result = text.slice(0, start) + text.slice(end + 1);
  else result = text.slice(0, Math.max(start - 1, 0));
  // Removing a section between two blank lines would leave a double gap.
  if (start >= 2 && result.slice(start - 2, start + 1) === "\n\n\n") {
    result = result.slice(0, start) + result.slice(start + 1);
  }
  return result;
}

function removeFlowItem(
  text: string,
  items: { start: number; end: number }[],
  index: number,
  open: number,
  close: number,
): string {
  const item = items[index] as { start: number; end: number };
  if (items.length === 1) return text.slice(0, open + 1) + text.slice(close - 1);
  const next = items[index + 1];
  if (next) return text.slice(0, item.start) + text.slice(next.start);
  const previous = items[index - 1] as { start: number; end: number };
  return text.slice(0, previous.end) + text.slice(item.end);
}

function remove(text: string, doc: YamlDocument, path: Path): string {
  if (path.length === 0) throw new Unsupported();
  const key = path.at(-1) as string | number;
  const parentPath = path.slice(0, -1);
  const parent = container(doc, parentPath);

  if (isMap(parent)) {
    const index = parent.items.findIndex((pair) => keyOf(pair) === String(key));
    if (index < 0) return text;
    const pair = parent.items[index] as Pair;
    const start = rangeOf(pair.key)[0];
    const end = pairEnd(text, pair);
    if (parent.flow) {
      const items = parent.items.map((p) => ({ start: rangeOf(p.key)[0], end: pairEnd(text, p) }));
      const [open, close] = rangeOf(parent);
      return removeFlowItem(text, items, index, open, close);
    }
    if (parent.items.length > 1) return removeLines(text, start, end);
    // The last entry of a map written in lines: leave an empty `{}` behind.
    const holder = pairAt(doc, parentPath);
    if (!holder) throw new Unsupported();
    const colon = text.indexOf(":", rangeOf(holder.key)[1]);
    const without = removeLines(text, start, end);
    return `${without.slice(0, colon + 1)} {}${without.slice(colon + 1)}`;
  }

  if (isSeq(parent) && typeof key === "number") {
    const item = parent.items[key];
    if (item === undefined) return text;
    const [start, end] = rangeOf(item);
    if (parent.flow) {
      const items = parent.items.map((node) => {
        const range = rangeOf(node);
        return { start: range[0], end: range[1] };
      });
      const [open, close] = rangeOf(parent);
      return removeFlowItem(text, items, key, open, close);
    }
    if (parent.items.length === 1) throw new Unsupported();
    return removeLines(text, start, end);
  }

  return text;
}

function applyToData(data: unknown, edit: Edit): unknown {
  const root: { value: unknown } = { value: data };
  let holder: Record<string | number, unknown> = root;
  let slot: string | number = "value";
  for (const key of edit.path) {
    let next = holder[slot];
    if (next === null || next === undefined || typeof next !== "object") {
      if (edit.op === "delete") return root.value;
      next = {};
      holder[slot] = next;
    }
    holder = next as Record<string | number, unknown>;
    slot = key;
  }
  if (edit.op === "set") holder[slot] = edit.value;
  else if (Array.isArray(holder)) holder.splice(slot as number, 1);
  else delete holder[slot];
  return root.value;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function reads(text: string, expected: unknown): boolean {
  const doc = parseDocument(text);
  return doc.errors.length === 0 && same(doc.toJS(), expected);
}

function setFlow(node: Node | null, depth: number): void {
  if (!isMap(node) && !isSeq(node)) return;
  if (depth <= 0) node.flow = true;
  for (const item of node.items) {
    setFlow((isMap(node) ? (item as Pair).value : item) as Node | null, depth - 1);
  }
}

/** Make the change through the YAML library. Keeps comments, normalises spacing. */
function reserialise(doc: YamlDocument, edit: Edit): string {
  if (edit.op === "delete") {
    if (doc.hasIn(edit.path)) doc.deleteIn(edit.path);
  } else {
    const node = doc.createNode(edit.value);
    setFlow(node, edit.block ?? 0);
    doc.setIn(edit.path, node as Scalar);
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Apply one change to model text. `order` is the usual order of top-level keys,
 * used to place a section that does not exist yet.
 */
export function applyEdit(text: string, edit: Edit, order: string[] = []): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new EditError("The text has a syntax error, so it cannot be changed from the drawing");
  }
  const expected = applyToData(structuredClone(doc.toJS() ?? {}), edit);

  let result: string | undefined;
  try {
    result =
      edit.op === "set"
        ? set(text, doc, edit.path, edit.value, edit.block ?? 0, order)
        : remove(text, doc, edit.path);
  } catch (error) {
    if (!(error instanceof Unsupported)) throw error;
  }
  if (result !== undefined && reads(result, expected)) return result;

  result = reserialise(doc, edit);
  if (reads(result, expected)) return result;
  throw new EditError("The change could not be written into the text");
}

export function applyEdits(text: string, edits: Edit[], order: string[] = []): string {
  return edits.reduce((current, edit) => applyEdit(current, edit, order), text);
}
