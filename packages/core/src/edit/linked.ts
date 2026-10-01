import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml";
import { UNITS } from "../expr/units.ts";

/**
 * Finding everywhere a name is used. A link, a point, a pin, a parameter or a
 * measure is named once, where it is defined, and referred to by that name
 * elsewhere: in joints, in expressions, in the pose. Given the place of a
 * definition in the text, this finds all the places that refer to it, so that an
 * editor can change them together.
 */

/** A stretch of the text, as offsets from its start. */
export interface Span {
  from: number;
  to: number;
}

export type NameKind = "body" | "point" | "joint" | "param" | "measure";

export interface LinkedName {
  kind: NameKind;
  name: string;
  /** For a point, the body it is on. */
  body?: string;
  /** Where it is defined: the key that names it. */
  definition: Span;
  /** Everywhere else it is written. */
  references: Span[];
}

type Path = (string | number)[];

/** How the value at a path refers to things. */
type Field = "ref" | "body" | "joint" | "expr" | "none";

function fieldAt(path: Path): Field {
  const [section, , key] = path;
  switch (section) {
    case "joints":
      if (key === "connect" || key === "axis") return "ref";
      if (key === "point" || key === "cam" || key === "follower") return "ref";
      if (key === "carrier") return "body";
      return key === "type" || key === "law" ? "none" : "expr";
    case "components":
      if (key === "connect") return "ref";
      // `at` is a point when it is one value, and a pair of coordinates otherwise.
      if (key === "at") return path.length === 3 ? "ref" : "expr";
      return key === "type" ? "none" : "expr";
    case "traces":
      return "ref";
    case "drivers":
      return key === "joint" ? "joint" : "expr";
    case "mekasim":
    case "meta":
      return "none";
    default:
      return "expr";
  }
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/g;

/** Where a scalar's own characters start in the text, when they are written as they read. */
function contentStart(text: string, node: Scalar): number | undefined {
  if (!node.range || typeof node.value !== "string") return undefined;
  const [from, to] = node.range;
  if (text.slice(from, to) === node.value) return from;
  // A quoted value without escapes sits one character in.
  return text.slice(from + 1, to - 1) === node.value ? from + 1 : undefined;
}

/**
 * Everything that refers to the name defined at `offset`, or undefined when
 * `offset` is not on a definition or the text cannot be read.
 */
export function linkedAt(text: string, offset: number): LinkedName | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined;

  const definitions: (Omit<LinkedName, "references"> & { section: string })[] = [];
  /** Every value that can hold a reference, with the path it sits at and where its text starts. */
  const values: { path: Path; value: string; at: number }[] = [];
  const poseKeys: { name: string; span: Span }[] = [];

  function define(kind: NameKind, key: unknown, section: string, body?: string): void {
    if (!isScalar(key) || !key.range || typeof key.value !== "string") return;
    const from = contentStart(text, key as Scalar);
    if (from === undefined) return;
    definitions.push({
      kind,
      name: key.value,
      body,
      section,
      definition: { from, to: from + key.value.length },
    });
  }

  function visit(node: unknown, path: Path): void {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : "";
        const [section, owner, group] = path;
        if (path.length === 1) {
          if (section === "params") define("param", pair.key, "params");
          if (section === "bodies" || section === "components") define("body", pair.key, section);
          if (section === "joints") define("joint", pair.key, "joints");
          if (section === "measures") define("measure", pair.key, "measures");
          if (section === "pose" && isScalar(pair.key)) {
            const from = contentStart(text, pair.key as Scalar);
            if (from !== undefined)
              poseKeys.push({ name: key, span: { from, to: from + key.length } });
          }
        }
        // The points of a body, the arms of a crank and the extra points of a rod.
        const naming =
          (section === "bodies" && group === "points") ||
          (section === "components" && (group === "arms" || group === "points"));
        if (path.length === 3 && naming) define("point", pair.key, String(section), String(owner));
        visit(pair.value, [...path, key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        visit(item, [...path, i]);
      });
    } else if (isScalar(node)) {
      const at = contentStart(text, node as Scalar);
      if (at !== undefined) values.push({ path, value: node.value as string, at });
    }
  }
  visit(doc.contents, []);

  const found = definitions.find((d) => d.definition.from <= offset && offset <= d.definition.to);
  if (!found) return undefined;
  const { kind, name, body } = found;
  const bodies = new Set(definitions.filter((d) => d.kind === "body").map((d) => d.name));
  const references: Span[] = [];
  const add = (from: number, length: number): void => {
    references.push({ from, to: from + length });
  };

  if (kind === "body") {
    for (const key of poseKeys) if (key.name === name) references.push(key.span);
  }

  for (const { path, value, at } of values) {
    const field = fieldAt(path);
    if (field === "none") continue;
    if (field === "body" || field === "joint") {
      if (field === kind && value === name) add(at, name.length);
      continue;
    }
    // In measures and plots a name can be a body or a point; elsewhere only a parameter.
    const measuring = path[0] === "measures" || path[0] === "plots";
    for (const match of value.matchAll(WORD)) {
      const word = match[0];
      const start = at + match.index;
      const [base, point] = word.split(".") as [string, string | undefined];
      if (field === "ref") {
        if (kind === "body" && base === name) add(start, base.length);
        if (kind === "point" && base === body && point === name)
          add(start + base.length + 1, name.length);
        continue;
      }
      // Not a name: a function, or a unit after a number.
      if (/^\s*\(/.test(value.slice(match.index + word.length))) continue;
      if (word in UNITS && /\d\s*$/.test(value.slice(0, match.index))) continue;

      if (point === undefined) {
        if (kind === "param" && word === name && !(measuring && bodies.has(word)))
          add(start, name.length);
        if (kind === "measure" && measuring && word === name && !bodies.has(word))
          add(start, name.length);
        if (kind === "body" && measuring && word === name) add(start, name.length);
      } else if (measuring) {
        if (kind === "body" && base === name) add(start, base.length);
        if (kind === "point" && base === body && point === name)
          add(start + base.length + 1, name.length);
      }
    }
  }

  // A use of the name that is itself the definition is not a reference to it.
  const { definition } = found;
  return {
    kind,
    name,
    body,
    definition,
    references: references
      .filter((span) => span.from !== definition.from)
      .sort((a, b) => a.from - b.from),
  };
}
