// Solve a model from the command line: node packages/core/src/cli.ts model.mekasim.yaml [--csv out.csv]
import { readFileSync, writeFileSync } from "node:fs";
import { pointMotion } from "./analysis/measures.ts";
import { docFactor, formatQuantity, unitLabel } from "./expr/units.ts";
import { type Simulation, simulate } from "./simulate.ts";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Traces and signal measures as one table, a row per sample, in document units. */
function csv(simulation: Simulation): string {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) return "";
  const { units } = compiled;
  const columns: [string, ArrayLike<number>, number][] = [["t [s]", cycle.t, 1]];
  const length = docFactor([1, 0, 0, 0], units);
  for (const ref of compiled.traces) {
    const motion = pointMotion(compiled, cycle, ref);
    columns.push(
      [`${ref}.x [${units.length}]`, motion.x, length],
      [`${ref}.y [${units.length}]`, motion.y, length],
    );
  }
  for (const { id, quantity } of simulation.measures) {
    if (!quantity || typeof quantity.value === "number") continue;
    const label = unitLabel(quantity.dim, units);
    columns.push([label ? `${id} [${label}]` : id, quantity.value, docFactor(quantity.dim, units)]);
  }
  const rows = [columns.map(([name]) => name).join(",")];
  for (let k = 0; k < cycle.count; k++) {
    rows.push(
      columns.map(([, values, factor]) => Number((values[k] / factor).toPrecision(10))).join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

function main(): number {
  const args = process.argv.slice(2);
  const csvAt = args.indexOf("--csv");
  const csvPath = csvAt >= 0 ? args.splice(csvAt, 2)[1] : undefined;
  const file = args[0];
  if (!file || (csvAt >= 0 && !csvPath)) {
    console.error("Usage: mekasim <model.mekasim.yaml> [--csv <out.csv>]");
    return 2;
  }

  const simulation = simulate(readFileSync(file, "utf8"));
  const { doc, compiled, cycle, mobility } = simulation;

  if (doc && compiled) {
    console.log(doc.meta?.name ?? file);
    const joints = Object.keys(doc.joints ?? {}).length;
    const drivers = Object.keys(doc.drivers ?? {}).length;
    const moving = compiled.model.bodies.length;
    console.log(
      `  ${moving} moving ${moving === 1 ? "body" : "bodies"}, ${plural(joints, "joint")}, ${plural(drivers, "driver")}`,
    );
    if (mobility) {
      const state = mobility.free === 0 ? "fully determined" : `${mobility.free} left free`;
      console.log(`  ${plural(mobility.mobility, "degree")} of freedom, ${state}`);
    }
    if (cycle && compiled.period > 0) {
      console.log(
        `  ${cycle.count} of ${cycle.steps} steps solved over ${Number(compiled.period.toPrecision(6))} s`,
      );
    }
  }

  const results = simulation.measures.filter((m) => m.quantity);
  if (compiled && results.length > 0) {
    const partial = cycle && cycle.count < cycle.steps;
    console.log(partial ? `\nMeasures (over the ${cycle.count} solved steps only)` : "\nMeasures");
    const width = Math.max(...results.map((m) => m.id.length));
    for (const { id, quantity } of results) {
      if (!quantity) continue;
      const { value, dim } = quantity;
      const text =
        typeof value === "number"
          ? formatQuantity(value, dim, compiled.units)
          : `${formatQuantity(value[0], dim, compiled.units)} at start (varies over the cycle)`;
      console.log(`  ${id.padEnd(width)}  ${text}`);
    }
  }

  if (simulation.diagnostics.length > 0) console.log("");
  for (const { severity, message, position } of simulation.diagnostics) {
    const where = position ? `${file}:${position.line}:${position.col}` : file;
    console.log(`${where}: ${severity}: ${message}`);
  }

  if (csvPath && cycle) {
    writeFileSync(csvPath, csv(simulation));
    console.log(`\nWrote ${cycle.count} rows to ${csvPath}`);
  }
  return simulation.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

process.exitCode = main();
