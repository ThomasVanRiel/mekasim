import { ExprError, type Node } from "./parse.ts";
import {
  ANGLE,
  compatible,
  type Dim,
  describeDim,
  dimDiv,
  dimMul,
  dimPow,
  docFactor,
  isPure,
  NONE,
  UNITS,
  type UnitDef,
  type Units,
} from "./units.ts";

/**
 * A value in SI with its dimension. A `Float64Array` is a signal: one value per
 * sample of the motion cycle.
 */
export interface Quantity {
  value: number | Float64Array;
  dim: Dim;
}

export interface EvalContext {
  units: Units;
  /** Units beyond mekasim's own, as the expression was parsed with. */
  extraUnits?: Record<string, UnitDef>;
  /** Value of a name such as a parameter. Throws `ExprError` when unknown. */
  resolve(name: string, node: Node): Quantity;
  /** Functions that need their arguments unevaluated, e.g. `x(body.point)`. */
  special?(name: string, args: Node[], node: Node): Quantity | undefined;
}

type Value = number | Float64Array;

const ACCELERATION: Dim = [1, -2, 0, 0];
const STANDARD_GRAVITY = 9.80665;

function map1(a: Value, f: (a: number) => number): Value {
  return typeof a === "number" ? f(a) : a.map(f);
}

function map2(a: Value, b: Value, f: (a: number, b: number) => number): Value {
  if (typeof a === "number") return typeof b === "number" ? f(a, b) : b.map((y) => f(a, y));
  if (typeof b === "number") return a.map((x) => f(x, b));
  return a.map((x, i) => f(x, b[i]));
}

/**
 * Bring two operands to a common dimension. A plain number next to a dimensioned
 * value is read in the document unit of that dimension, so `r + 10` adds 10 mm.
 */
function unify(a: Quantity, b: Quantity, units: Units, node: Node): [Value, Value, Dim] {
  if (compatible(a.dim, b.dim)) return [a.value, b.value, a.dim];
  if (isPure(a.dim)) {
    const factor = docFactor(b.dim, units);
    return [map1(a.value, (x) => x * factor), b.value, b.dim];
  }
  if (isPure(b.dim)) {
    const factor = docFactor(a.dim, units);
    return [a.value, map1(b.value, (x) => x * factor), a.dim];
  }
  throw new ExprError(`Cannot combine ${describeDim(a.dim)} with ${describeDim(b.dim)}`, node.pos);
}

function reduce(a: Value, f: (samples: Float64Array) => number): number {
  return f(typeof a === "number" ? Float64Array.of(a) : a);
}

function minOf(samples: Float64Array): number {
  return samples.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
}

function maxOf(samples: Float64Array): number {
  return samples.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
}

/** Collapse a signal over the cycle to one number. */
const REDUCERS: Record<string, (samples: Float64Array) => number> = {
  min: minOf,
  max: maxOf,
  range: (s) => maxOf(s) - minOf(s),
  mean: (s) => s.reduce((a, b) => a + b, 0) / s.length,
};

const TRIG: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const INVERSE_TRIG: Record<string, (x: number) => number> = {
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
};

const COMPARE: Record<string, (a: number, b: number) => number> = {
  "<": (a, b) => (a < b ? 1 : 0),
  "<=": (a, b) => (a <= b ? 1 : 0),
  ">": (a, b) => (a > b ? 1 : 0),
  ">=": (a, b) => (a >= b ? 1 : 0),
};

/** A side of `and`, `or` or `not`: a yes or no, which is a plain number that is not 0. */
function condition(node: Node, word: string, ctx: EvalContext): Value {
  const { value, dim } = evaluate(node, ctx);
  if (!isPure(dim)) {
    throw new ExprError(
      `"${word}" joins conditions such as a < b, and this is ${describeDim(dim)}`,
      node.pos,
    );
  }
  return value;
}

export const FUNCTION_NAMES = [
  ...Object.keys(TRIG),
  ...Object.keys(INVERSE_TRIG),
  ...Object.keys(REDUCERS),
  "atan2",
  "sqrt",
  "abs",
  "change",
  "hypot",
];

function arity(node: Node & { kind: "call" }, min: number, max = min): void {
  const n = node.args.length;
  if (n >= min && n <= max) return;
  const wanted =
    min === max
      ? `${min}`
      : max === Number.POSITIVE_INFINITY
        ? `at least ${min}`
        : `${min} to ${max}`;
  throw new ExprError(
    `${node.name}() takes ${wanted} argument${wanted === "1" ? "" : "s"}, got ${n}`,
    node.pos,
  );
}

function call(node: Node & { kind: "call" }, ctx: EvalContext): Quantity {
  const special = ctx.special?.(node.name, node.args, node);
  if (special) return special;

  const { name } = node;
  const args = node.args.map((arg) => evaluate(arg, ctx));
  const first = args[0] as Quantity;

  const trig = TRIG[name];
  if (trig) {
    arity(node, 1);
    if (isPure(first.dim)) {
      const factor = docFactor(ANGLE, ctx.units);
      return { value: map1(first.value, (x) => trig(x * factor)), dim: NONE };
    }
    if (!compatible(first.dim, ANGLE)) {
      throw new ExprError(`${name}() needs an angle, got ${describeDim(first.dim)}`, node.pos);
    }
    return { value: map1(first.value, trig), dim: NONE };
  }

  const inverse = INVERSE_TRIG[name];
  if (inverse) {
    arity(node, 1);
    if (!isPure(first.dim)) {
      throw new ExprError(
        `${name}() needs a plain number, got ${describeDim(first.dim)}`,
        node.pos,
      );
    }
    return { value: map1(first.value, inverse), dim: ANGLE };
  }

  const reducer = REDUCERS[name];
  if (reducer && (args.length === 1 || name === "range" || name === "mean")) {
    arity(node, 1);
    return { value: reduce(first.value, reducer), dim: first.dim };
  }

  switch (name) {
    case "min":
    case "max":
    case "hypot": {
      arity(node, 2, Number.POSITIVE_INFINITY);
      const f = name === "hypot" ? Math.hypot : name === "min" ? Math.min : Math.max;
      return args.slice(1).reduce((acc, arg) => {
        const [a, b, dim] = unify(acc, arg, ctx.units, node);
        return { value: map2(a, b, f), dim };
      }, first);
    }
    case "atan2": {
      arity(node, 2);
      const [y, x] = unify(first, args[1] as Quantity, ctx.units, node);
      return { value: map2(y, x, Math.atan2), dim: ANGLE };
    }
    case "sqrt":
      arity(node, 1);
      return { value: map1(first.value, Math.sqrt), dim: dimPow(first.dim, 0.5) };
    case "abs":
      arity(node, 1);
      return { value: map1(first.value, Math.abs), dim: first.dim };
    case "change": {
      // How far a value has moved from where it started: the value less its first sample.
      arity(node, 1);
      const { value } = first;
      if (typeof value === "number") return { value: 0, dim: first.dim };
      const start = value[0] ?? 0;
      return { value: value.map((x) => x - start), dim: first.dim };
    }
    default:
      throw new ExprError(`Unknown function "${name}"`, node.pos);
  }
}

export function evaluate(node: Node, ctx: EvalContext): Quantity {
  switch (node.kind) {
    case "num": {
      if (!node.unit) return { value: node.value, dim: NONE };
      const unit = (ctx.extraUnits?.[node.unit] ?? UNITS[node.unit]) as UnitDef;
      return { value: node.value * unit.factor, dim: unit.dim };
    }
    case "ref":
      if (node.name === "pi") return { value: Math.PI, dim: NONE };
      if (node.name === "g") return { value: STANDARD_GRAVITY, dim: ACCELERATION };
      return ctx.resolve(node.name, node);
    case "neg": {
      const arg = evaluate(node.arg, ctx);
      return { value: map1(arg.value, (x) => -x), dim: arg.dim };
    }
    case "call":
      return call(node, ctx);
    case "compare": {
      const [a, b] = unify(evaluate(node.left, ctx), evaluate(node.right, ctx), ctx.units, node);
      return { value: map2(a, b, COMPARE[node.op] as (a: number, b: number) => number), dim: NONE };
    }
    case "logic": {
      const left = condition(node.left, node.op, ctx);
      const right = condition(node.right, node.op, ctx);
      const both = node.op === "and";
      return {
        value: map2(left, right, (x, y) =>
          (both ? x !== 0 && y !== 0 : x !== 0 || y !== 0) ? 1 : 0,
        ),
        dim: NONE,
      };
    }
    case "not":
      return { value: map1(condition(node.arg, "not", ctx), (x) => (x === 0 ? 1 : 0)), dim: NONE };
    case "bin": {
      const left = evaluate(node.left, ctx);
      const right = evaluate(node.right, ctx);
      switch (node.op) {
        case "+":
        case "-": {
          const [a, b, dim] = unify(left, right, ctx.units, node);
          const sign = node.op === "+" ? 1 : -1;
          return { value: map2(a, b, (x, y) => x + sign * y), dim };
        }
        case "*":
          return {
            value: map2(left.value, right.value, (x, y) => x * y),
            dim: dimMul(left.dim, right.dim),
          };
        case "/":
          return {
            value: map2(left.value, right.value, (x, y) => x / y),
            dim: dimDiv(left.dim, right.dim),
          };
        case "^": {
          if (!isPure(right.dim) || typeof right.value !== "number") {
            throw new ExprError("An exponent must be a plain number", node.pos);
          }
          const p = right.value;
          return { value: map1(left.value, (x) => x ** p), dim: dimPow(left.dim, p) };
        }
      }
    }
  }
}

/**
 * Read a quantity as an SI value of the expected dimension. A plain number is taken
 * to be in `bareUnit` (the document unit when omitted).
 */
export function toSI(q: Quantity, expected: Dim, units: Units, bareUnit?: string): Value {
  if (isPure(q.dim) && !isPure(expected)) {
    const factor = bareUnit
      ? (UNITS[bareUnit] as (typeof UNITS)[string]).factor
      : docFactor(expected, units);
    return map1(q.value, (x) => x * factor);
  }
  if (!compatible(q.dim, expected)) {
    throw new ExprError(`Expected ${describeDim(expected)}, got ${describeDim(q.dim)}`, 0);
  }
  return q.value;
}
