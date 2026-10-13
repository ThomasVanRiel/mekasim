import { UNITS } from "./units.ts";

export type Node =
  | { kind: "num"; value: number; unit?: string; pos: number }
  /** A parameter (`r`), a body (`rocker`) or a point on a body (`rocker.B`). */
  | { kind: "ref"; name: string; pos: number }
  | { kind: "call"; name: string; args: Node[]; pos: number }
  | { kind: "neg"; arg: Node; pos: number }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node; pos: number }
  /** A comparison, which gives 1 where it holds and 0 where it does not. */
  | { kind: "compare"; op: "<" | "<=" | ">" | ">="; left: Node; right: Node; pos: number }
  | { kind: "logic"; op: "and" | "or"; left: Node; right: Node; pos: number }
  | { kind: "not"; arg: Node; pos: number };

export class ExprError extends Error {
  /** Offset into the expression text. */
  readonly pos: number;

  constructor(message: string, pos: number) {
    super(message);
    this.name = "ExprError";
    this.pos = pos;
  }
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/y;
const WORD = /[A-Za-z_][A-Za-z0-9_/]*/y;
const UNIT_NAMES = Object.keys(UNITS).sort((a, b) => b.length - a.length);

/** Words that join conditions, and so cannot be names. */
export const KEYWORDS = ["and", "or", "not"];

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Parse an expression such as `2 * r + 10 mm` or `range(x(coupler.P))`.
 *
 * A unit may follow a number literal directly (`40 mm`, `300 rpm`). There is no
 * implicit multiplication, so a name after a number is always read as a unit.
 * `extraUnits` are units beyond mekasim's own, from a registry.
 *
 * Comparisons bind more loosely than arithmetic, and `not`, `and` and `or` more
 * loosely still, in that order: `not a < b + 1 and c` is `(not (a < (b + 1))) and c`.
 */
export function parseExpr(src: string, extraUnits?: Record<string, unknown>): Node {
  const unitNames = extraUnits
    ? [...UNIT_NAMES, ...Object.keys(extraUnits)].sort((a, b) => b.length - a.length)
    : UNIT_NAMES;
  let i = 0;

  function skip(): void {
    while (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r") i++;
  }

  function match(re: RegExp): string | undefined {
    re.lastIndex = i;
    return re.exec(src)?.[0];
  }

  function expect(ch: string): void {
    skip();
    if (src[i] !== ch) {
      throw new ExprError(`Expected "${ch}"${i < src.length ? ` but found "${src[i]}"` : ""}`, i);
    }
    i++;
  }

  /** Whether a word that joins conditions comes next. */
  function word(keyword: string): boolean {
    skip();
    return src.startsWith(keyword, i) && !isNameChar(src[i + keyword.length]);
  }

  function either(): Node {
    let left = both();
    while (word("or")) {
      const pos = i;
      i += 2;
      left = { kind: "logic", op: "or", left, right: both(), pos };
    }
    return left;
  }

  function both(): Node {
    let left = negation();
    while (word("and")) {
      const pos = i;
      i += 3;
      left = { kind: "logic", op: "and", left, right: negation(), pos };
    }
    return left;
  }

  function negation(): Node {
    if (!word("not")) return comparison();
    const pos = i;
    i += 3;
    return { kind: "not", arg: negation(), pos };
  }

  function comparing(): "<" | "<=" | ">" | ">=" | undefined {
    skip();
    const sign = src[i];
    if (sign !== "<" && sign !== ">") return undefined;
    return src[i + 1] === "=" ? `${sign}=` : sign;
  }

  function comparison(): Node {
    const left = additive();
    const op = comparing();
    if (!op) return left;
    const pos = i;
    i += op.length;
    const right = additive();
    // `a < b < c` would compare the 1 or 0 of `a < b` with c, which nobody means.
    if (comparing())
      throw new ExprError('Compare two values at a time, and join with "and": a < b and b < c', i);
    return { kind: "compare", op, left, right, pos };
  }

  function additive(): Node {
    let left = multiplicative();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") return left;
      const pos = i++;
      left = { kind: "bin", op, left, right: multiplicative(), pos };
    }
  }

  function multiplicative(): Node {
    let left = unary();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/") return left;
      const pos = i++;
      left = { kind: "bin", op, left, right: unary(), pos };
    }
  }

  function unary(): Node {
    skip();
    if (src[i] === "-") {
      const pos = i++;
      return { kind: "neg", arg: unary(), pos };
    }
    if (src[i] === "+") {
      i++;
      return unary();
    }
    return power();
  }

  function power(): Node {
    const base = primary();
    skip();
    if (src[i] !== "^") return base;
    const pos = i++;
    return { kind: "bin", op: "^", left: base, right: unary(), pos };
  }

  function unit(): string | undefined {
    const start = i;
    skip();
    for (const name of unitNames) {
      if (src.startsWith(name, i) && !isNameChar(src[i + name.length])) {
        i += name.length;
        return name;
      }
    }
    const found = match(WORD);
    if (found && !KEYWORDS.includes(found)) throw new ExprError(`Unknown unit "${found}"`, i);
    i = start;
    return undefined;
  }

  function primary(): Node {
    skip();
    const pos = i;
    const number = match(NUMBER);
    if (number) {
      i += number.length;
      return { kind: "num", value: Number(number), unit: unit(), pos };
    }
    const name = match(NAME);
    if (name && !KEYWORDS.includes(name)) {
      i += name.length;
      skip();
      if (src[i] !== "(") return { kind: "ref", name, pos };
      i++;
      const args: Node[] = [];
      skip();
      if (src[i] === ")") {
        i++;
        return { kind: "call", name, args, pos };
      }
      for (;;) {
        args.push(either());
        skip();
        if (src[i] === ",") {
          i++;
          continue;
        }
        expect(")");
        return { kind: "call", name, args, pos };
      }
    }
    if (src[i] === "(") {
      i++;
      const inner = either();
      expect(")");
      return inner;
    }
    if (i >= src.length) throw new ExprError("Unexpected end of expression", i);
    throw new ExprError(`Unexpected "${src[i]}"`, i);
  }

  const node = either();
  skip();
  if (i < src.length) throw new ExprError(`Unexpected "${src[i]}"`, i);
  return node;
}
