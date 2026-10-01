import { docFactor, LENGTH, unitLabel } from "../expr/units.ts";
import type { Simulation } from "../simulate.ts";
import { cycleAxis, pointMotion } from "./measures.ts";

/** A field of a CSV row, quoted when it contains a comma or a quote. */
function field(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The motion as a table, one row per sample, in document units: time, what the
 * cycle is plotted against, the traced points, and every measure and plot series
 * that varies over the cycle.
 */
export function toCsv(simulation: Simulation): string {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) return "";
  const { units } = compiled;
  const columns = new Map<string, { values: ArrayLike<number>; factor: number }>();
  const add = (name: string, label: string, values: ArrayLike<number>, factor: number): void => {
    const header = label ? `${name} [${label}]` : name;
    // A plot often repeats a measure; one column is enough.
    if (!columns.has(header)) columns.set(header, { values, factor });
  };

  add("t", "s", cycle.t, 1);
  const axis = cycleAxis(compiled, cycle);
  if (axis.label !== "time") {
    const { value, dim } = axis.quantity;
    add(axis.label, unitLabel(dim, units), value as Float64Array, docFactor(dim, units));
  }
  const length = docFactor(LENGTH, units);
  for (const ref of compiled.traces) {
    const motion = pointMotion(compiled, cycle, ref);
    add(`${ref}.x`, units.length, motion.x, length);
    add(`${ref}.y`, units.length, motion.y, length);
  }
  const series = [
    ...simulation.measures.map((m) => ({ name: m.id, quantity: m.quantity })),
    ...simulation.plots.flatMap((p) =>
      p.series.map((s) => ({ name: s.source, quantity: s.quantity })),
    ),
  ];
  for (const { name, quantity } of series) {
    if (!quantity || typeof quantity.value === "number") continue;
    add(name, unitLabel(quantity.dim, units), quantity.value, docFactor(quantity.dim, units));
  }

  const rows = [[...columns.keys()].map(field).join(",")];
  for (let k = 0; k < cycle.count; k++) {
    rows.push(
      [...columns.values()]
        .map(({ values, factor }) => Number(((values[k] as number) / factor).toPrecision(10)))
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}
