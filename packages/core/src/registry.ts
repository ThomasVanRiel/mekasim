import type { Cycle } from "./analysis/cycle.ts";
import type { Compiled } from "./compile/compile.ts";
import type { Quantity } from "./expr/evaluate.ts";
import type { Node } from "./expr/parse.ts";
import type { UnitDef } from "./expr/units.ts";

/** What a function added to the expressions is called with. */
export interface FunctionCall {
  /** The arguments as written, for a function that takes names rather than values. */
  args: Node[];
  /** The call itself, for the place of an error. */
  node: Node;
  /** The value of an argument. */
  evaluate(arg: Node): Quantity;
  compiled: Compiled;
  cycle: Cycle;
}

/**
 * Units and functions that a format built on mekasim adds to its expressions. The
 * units are read everywhere; the functions in measures, checks and plots, where there
 * is a motion to ask about. mekasim passes none.
 */
export interface Registry {
  units?: Record<string, UnitDef>;
  /** Each gives a value, or a signal with one value per solved sample. */
  functions?: Record<string, (call: FunctionCall) => Quantity>;
}
