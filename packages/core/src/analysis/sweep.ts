import { editText } from "../edit/operations.ts";
import { load } from "../schema/load.ts";
import { type SimulateOptions, type Simulation, simulate } from "../simulate.ts";

export interface SweepRun {
  /** The parameter's value for this run, as written into the model. */
  value: number | string;
  simulation: Simulation;
}

/**
 * Solve the model once for each value of a parameter, leaving everything else as
 * it is. `unit` is appended to each value, as in `15 mm`.
 */
export function sweep(
  text: string,
  param: string,
  values: number[],
  unit = "",
  options: SimulateOptions = {},
): SweepRun[] {
  // A parameter written with bounds keeps them; only its value is varied.
  const bounded = typeof load(text, options.schema).doc?.params?.[param] === "object";
  const path = bounded ? ["params", param, "value"] : ["params", param];
  return values.map((number) => {
    const value = unit ? `${number} ${unit}` : number;
    const varied = editText(text, [{ op: "set", path, value }]);
    return { value, simulation: simulate(varied, options) };
  });
}
