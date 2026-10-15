import {
  type Compiled,
  type Diagnostic,
  type Dim,
  type Document,
  docFactor,
  type EvalContext,
  ExprError,
  evaluate,
  formatQuantity,
  NONE,
  parseExpr,
  type Quantity,
  toSI,
  UNITS,
  type UnitDef,
} from "@mekasim/core";
import type * as z from "zod";
import { FORCE_UNITS, shownUnit } from "../registry.ts";
import type { Range, Study } from "../schema.ts";

type StudyEntry = z.infer<typeof Study>;
type RangeEntry = z.infer<typeof Range>;
type StudyDocument = Document & { studies?: Record<string, StudyEntry> };

/** A range in SI: evenly between two values, normal round a mean, or one of a list. */
export type StudyRange =
  | { kind: "even"; from: number; to: number; steps?: number }
  | { kind: "normal"; mean: number; spread: number; min?: number; max?: number }
  | { kind: "pick"; values: number[] };

export type Sampling = "random" | "spread" | "grid";

/** One varied parameter: its range, and how a value of it is written into the model. */
export interface Varied {
  name: string;
  range: StudyRange;
  dim: Dim;
  /** Where its value is in the model: under `params`, or under its `value` when it has bounds. */
  path: string[];
}

/** A study as it is run: everything read and checked, values in SI. */
export interface StudyPlan {
  name: string;
  sample: Sampling;
  /** How many runs: as asked, or every combination for a grid. */
  runs: number;
  seed: number;
  varied: Varied[];
  /** The study's own conditions, which take the place of the model's `checks`. */
  pass?: Record<string, string>;
}

export const DEFAULT_RUNS = 100;
export const MOST_RUNS = 100000;

/** Units a varied value can be written in besides the document's: those whose SI value is 1. */
const SI_UNITS: Record<string, UnitDef> = { ...UNITS, ...FORCE_UNITS };

function same(a: Dim, b: Dim): boolean {
  return a.every((exponent, i) => exponent === b[i]);
}

/** The unit a value of this kind is written in, or nothing when it has none to write. */
function unitFor(dim: Dim, units: Compiled["units"]): string | undefined {
  if (same(dim, NONE)) return "";
  for (const unit of [units.length, units.angle]) {
    if (same((UNITS[unit] as UnitDef).dim, dim)) return unit;
  }
  return Object.entries(SI_UNITS).find(([, def]) => def.factor === 1 && same(def.dim, dim))?.[0];
}

/** A value as it is written into the model: a number in the document's unit, or in SI. */
export function writtenValue(value: number, dim: Dim, units: Compiled["units"]): number | string {
  const unit = unitFor(dim, units) ?? "";
  const factor = unit === units.length || unit === units.angle ? docFactor(dim, units) : 1;
  const shown = Number((value / factor).toPrecision(12));
  return unit ? `${shown} ${unit}` : shown;
}

/** A value as it is shown: in the document's units, forces in newtons. */
export function shownValue(value: number, dim: Dim, units: Compiled["units"], digits = 4): string {
  const unit = shownUnit(dim, units);
  if (!unit) return formatQuantity(value, dim, units, digits);
  return `${Number((value / unit.factor).toPrecision(digits))} ${unit.label}`;
}

/**
 * Read and check the studies of a model against its compiled parameters. Each problem is
 * reported at its place, and a study with a problem is left out.
 */
export function compileStudies(
  compiled: Compiled,
  source: Document,
  report: (diagnostic: Diagnostic) => void,
): Map<string, StudyPlan> {
  const doc = source as StudyDocument;
  const plans = new Map<string, StudyPlan>();
  const { units } = compiled;
  const context: EvalContext = {
    units,
    extraUnits: FORCE_UNITS,
    resolve(name, node) {
      const known = compiled.params.get(name);
      if (!known) throw new ExprError(`Unknown parameter "${name}"`, node.pos);
      return known;
    },
  };

  for (const [name, study] of Object.entries(doc.studies ?? {})) {
    const at = (...path: (string | number)[]): (string | number)[] => ["studies", name, ...path];
    let failed = false;
    const fail = (message: string, path: (string | number)[]): void => {
      report({ severity: "error", message, path });
      failed = true;
    };
    const sample = study.sample ?? "spread";

    /** A value of the range, in the kind of quantity the parameter is. */
    const read = (source: string | number, dim: Dim, path: (string | number)[]): number => {
      try {
        const quantity: Quantity =
          typeof source === "number"
            ? { value: source, dim: NONE }
            : evaluate(parseExpr(source, FORCE_UNITS), context);
        return toSI(quantity, dim, units) as number;
      } catch (error) {
        if (!(error instanceof ExprError)) throw error;
        fail(typeof source === "string" ? `${error.message} in "${source}"` : error.message, path);
        return Number.NaN;
      }
    };

    const entries: [string, RangeEntry | undefined][] = Array.isArray(study.vary)
      ? study.vary.map((param) => [param, undefined])
      : Object.entries(study.vary);
    const varied: Varied[] = [];
    entries.forEach(([param, entry], i) => {
      const where = Array.isArray(study.vary) ? at("vary", i) : at("vary", param);
      const value = compiled.params.get(param);
      if (!value) {
        fail(`"${param}" is not a parameter of the model`, where);
        return;
      }
      const { dim } = value;
      if (unitFor(dim, units) === undefined) {
        fail(`"${param}" is a quantity that a study cannot vary yet`, where);
        return;
      }
      const bounds = compiled.bounds.get(param) ?? {};
      const written = source.params?.[param];
      const path = typeof written === "object" ? ["params", param, "value"] : ["params", param];
      const show = (size: number): string => formatQuantity(size, dim, units);

      let range: StudyRange;
      if (entry === undefined) {
        if (bounds.min === undefined || bounds.max === undefined) {
          fail(
            `"${param}" has no least and most value to vary it between; give it min and max, or give the study a range for it`,
            where,
          );
          return;
        }
        range = {
          kind: "even",
          from: bounds.min,
          to: bounds.max,
          steps: sample === "grid" ? 5 : undefined,
        };
      } else if ("from" in entry) {
        const from = read(entry.from, dim, [...where, "from"]);
        const to = read(entry.to, dim, [...where, "to"]);
        if (from > to)
          fail(`The range runs backwards: ${show(from)} is more than ${show(to)}`, [
            ...where,
            "to",
          ]);
        if (sample === "grid" && entry.steps === undefined)
          fail("A grid needs `steps`: how many values to take in this range", where);
        range = { kind: "even", from, to, steps: entry.steps };
      } else if ("mean" in entry) {
        const mean = read(entry.mean, dim, [...where, "mean"]);
        const spread = read(entry.spread, dim, [...where, "spread"]);
        if (spread < 0) fail("The spread cannot be less than zero", [...where, "spread"]);
        if (sample === "grid")
          fail(
            "A grid takes evenly spaced values, with `from`, `to` and `steps`, or `pick`",
            where,
          );
        if (
          (bounds.min !== undefined && mean < bounds.min) ||
          (bounds.max !== undefined && mean > bounds.max)
        )
          fail(`The mean, ${show(mean)}, is outside the parameter's bounds`, [...where, "mean"]);
        range = { kind: "normal", mean, spread, ...bounds };
      } else {
        range = {
          kind: "pick",
          values: entry.pick.map((pick, k) => read(pick, dim, [...where, "pick", k])),
        };
      }
      // A study keeps to a parameter's bounds, as its slider does.
      const ends =
        range.kind === "even" ? [range.from, range.to] : range.kind === "pick" ? range.values : [];
      for (const end of ends) {
        if (Number.isNaN(end)) continue;
        if (bounds.min !== undefined && end < bounds.min - 1e-12 * Math.abs(bounds.min))
          fail(`${show(end)} is below the least "${param}" may be, ${show(bounds.min)}`, where);
        else if (bounds.max !== undefined && end > bounds.max + 1e-12 * Math.abs(bounds.max))
          fail(`${show(end)} is above the most "${param}" may be, ${show(bounds.max)}`, where);
      }
      varied.push({ name: param, range, dim, path });
    });

    for (const [id, condition] of Object.entries(study.pass ?? {})) {
      try {
        parseExpr(condition, FORCE_UNITS);
      } catch (error) {
        if (!(error instanceof ExprError)) throw error;
        fail(`${error.message} in "${condition}"`, at("pass", id));
      }
    }
    if (failed) continue;

    let runs = study.runs ?? DEFAULT_RUNS;
    if (sample === "grid") {
      runs = varied.reduce((count, { range }) => count * gridCount(range), 1);
      if (runs > MOST_RUNS) {
        fail(
          `This grid has ${runs} combinations, more than the ${MOST_RUNS} a study can run`,
          at("vary"),
        );
        continue;
      }
    }
    if (!study.pass && !source.checks) {
      report({
        severity: "warning",
        message:
          "This study has nothing to test, so every run that solves passes. Give the model checks, or the study pass conditions",
        path: at(),
      });
    }
    plans.set(name, { name, sample, runs, seed: study.seed ?? 1, varied, pass: study.pass });
  }
  return plans;
}

/** How many values a range takes in a grid. */
export function gridCount(range: StudyRange): number {
  if (range.kind === "pick") return range.values.length;
  if (range.kind === "even") return range.steps ?? 1;
  return 1;
}
