// mekacarve from the command line:
//   node packages/carve/src/cli.ts touches <model.mekafit.yaml> <study> [--runs N] [--cell mm] [--out dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drawingsBeside } from "@mekasim/core/disk";
import { FitDocument, prepareStudy } from "@mekasim/fit";
import { tally } from "./grid.ts";
import { gatherInThreads } from "./node.ts";
import { touchSvg } from "./svg.ts";

const USAGE =
  "Usage: carve touches <model.mekafit.yaml> <study> [--runs <count>] [--cell <mm>] [--out <folder>]";

/** The side of a cell unless one is asked for, in millimetres. */
const CELL_MM = 0.25;

function option(args: string[], name: string): string | undefined | null {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  return value ?? null;
}

async function touches(args: string[]): Promise<number> {
  const runsText = option(args, "--runs");
  const cellText = option(args, "--cell");
  const out = option(args, "--out");
  const [file, name] = args;
  const runs = runsText ? Number(runsText) : undefined;
  const cellMm = cellText ? Number(cellText) : CELL_MM;
  if (
    !file ||
    !name ||
    runsText === null ||
    cellText === null ||
    out === null ||
    (runs !== undefined && !(Number.isInteger(runs) && runs > 0)) ||
    !(cellMm > 0)
  ) {
    console.error(USAGE);
    return 2;
  }
  const text = readFileSync(file, "utf8");
  const files = drawingsBeside(file, text, FitDocument);
  const prepared = prepareStudy(text, name, files, runs);
  if ("error" in prepared) {
    console.error(`${file}: ${prepared.error}`);
    return 1;
  }
  const { plan, simulation } = prepared;
  const folder = out ?? ".";
  const title = simulation.doc?.meta?.name ?? file;
  console.log(`${title}: where study "${name}" touches the parts, ${plan.runs} runs`);
  const gathered = await gatherInThreads(text, files, name, plan.runs, cellMm / 1000, {
    progress: (done) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done} of ${plan.runs}`);
    },
  }).catch((error: Error) => error);
  if (process.stdout.isTTY) process.stdout.write("\r");
  if (gathered instanceof Error) {
    console.error(`${file}: ${gathered.message}`);
    return 1;
  }
  const { results, parts, grids, threads, ms } = gathered;
  const passed = results.filter(({ outcome }) => outcome === "passed").length;
  const failed = results.filter(({ outcome }) => outcome === "failed").length;
  const unsolved = results.length - passed - failed;
  const seconds = Number((ms / 1000).toPrecision(3));
  console.log(
    `  ran in ${seconds} s on ${threads} ${threads === 1 ? "thread" : "threads"}: ${passed} passed, ${failed} failed${unsolved > 0 ? `, ${unsolved} could not be solved` : ""}\n`,
  );
  mkdirSync(folder, { recursive: true });
  for (const part of parts) {
    const grid = grids.get(part.name);
    if (!grid) continue;
    const path = join(folder, `${part.name}.svg`);
    writeFileSync(path, touchSvg(part, grid, { passed, failed }));
    const { onlyFailed, both, onlyPassed } = tally(grid);
    const also = part.bodies.length > 1 ? ` (also ${part.bodies.slice(1).join(", ")})` : "";
    console.log(
      `  ${part.name}${also}: ${onlyFailed} cells touched only in failing runs, ${both} in both, ${onlyPassed} only in passing ones`,
    );
    console.log(`    ${path}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "touches") return touches(args);
  console.error(USAGE);
  return 2;
}

process.exitCode = await main();
