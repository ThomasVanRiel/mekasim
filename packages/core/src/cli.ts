// Solve a model from the command line: node packages/core/src/cli.ts model.mekasim.yaml [--csv out.csv] [--dxf out.dxf]
import { readFileSync, writeFileSync } from "node:fs";
import { toCsv } from "./analysis/csv.ts";
import { drawingsBeside } from "./drawing/disk.ts";
import { formatQuantity } from "./expr/units.ts";
import { toPointsDxf } from "./fabricate/dxf.ts";
import { simulate } from "./simulate.ts";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function main(): number {
  const args = process.argv.slice(2);
  const csvAt = args.indexOf("--csv");
  const csvPath = csvAt >= 0 ? args.splice(csvAt, 2)[1] : undefined;
  const dxfAt = args.indexOf("--dxf");
  const dxfPath = dxfAt >= 0 ? args.splice(dxfAt, 2)[1] : undefined;
  const file = args[0];
  if (!file || (csvAt >= 0 && !csvPath) || (dxfAt >= 0 && !dxfPath)) {
    console.error("Usage: mekasim <model.mekasim.yaml> [--csv <out.csv>] [--dxf <out.dxf>]");
    return 2;
  }

  const text = readFileSync(file, "utf8");
  // Drawings the model names are looked for beside it.
  const simulation = simulate(text, { files: drawingsBeside(file, text) });
  const { doc, compiled, cycle, mobility } = simulation;

  if (doc && compiled) {
    console.log(doc.meta?.name ?? file);
    const joints = compiled.joints.length + compiled.spatialJoints.length;
    const drivers = compiled.drivers.length;
    const moving = compiled.model.bodies.length + compiled.spatial.size;
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

  const checks = simulation.checks.filter((c) => c.holds !== undefined);
  if (checks.length > 0) {
    console.log("\nChecks");
    const width = Math.max(...checks.map((c) => c.id.length));
    for (const { id, holds, fails } of checks) {
      const where = fails
        ? ` at ${fails.count} of ${cycle?.count} steps, first at step ${fails.first}`
        : "";
      console.log(`  ${id.padEnd(width)}  ${holds ? "met" : `not met${where}`}`);
    }
  }

  if (simulation.diagnostics.length > 0) console.log("");
  for (const { severity, message, position } of simulation.diagnostics) {
    const where = position ? `${file}:${position.line}:${position.col}` : file;
    console.log(`${where}: ${severity}: ${message}`);
  }

  if (csvPath && cycle) {
    writeFileSync(csvPath, toCsv(simulation));
    console.log(`\nWrote ${cycle.count} rows to ${csvPath}`);
  }
  if (dxfPath && cycle && cycle.count > 0) {
    writeFileSync(dxfPath, toPointsDxf(simulation));
    console.log(`${csvPath ? "" : "\n"}Wrote the joints at the start of the cycle to ${dxfPath}`);
  }
  return simulation.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

process.exitCode = main();
