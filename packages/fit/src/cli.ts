// mekafit from the command line:
//   node packages/fit/src/cli.ts study <model.mekafit.yaml> <study> [--runs N] [--csv out.csv]
import { readFileSync, writeFileSync } from "node:fs";
import { drawingsBeside } from "@mekasim/core/disk";
import { FitDocument } from "./schema.ts";
import { runInThreads } from "./study/node.ts";
import { studyCsv, studyReport } from "./study/report.ts";
import { prepareStudy } from "./study/run.ts";
import { summarize } from "./study/stats.ts";

const USAGE = "Usage: fit:study <model.mekafit.yaml> <study> [--runs <count>] [--csv <out.csv>]";

function option(args: string[], name: string): string | undefined | null {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  return value ?? null;
}

async function study(args: string[]): Promise<number> {
  const runsText = option(args, "--runs");
  const csvPath = option(args, "--csv");
  const [file, name] = args;
  const runs = runsText ? Number(runsText) : undefined;
  if (
    !file ||
    !name ||
    runsText === null ||
    csvPath === null ||
    (runs !== undefined && !(Number.isInteger(runs) && runs > 0))
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
  const units = simulation.compiled?.units ?? { length: "mm", angle: "deg" };
  const title = simulation.doc?.meta?.name ?? file;
  console.log(`${title}: study "${name}", ${plan.runs} runs`);
  const { results, threads, ms } = await runInThreads(text, files, name, plan.runs, {
    progress: (done) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done} of ${plan.runs}`);
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\r");
  const seconds = Number((ms / 1000).toPrecision(3));
  console.log(`  ran in ${seconds} s on ${threads} ${threads === 1 ? "thread" : "threads"}\n`);
  console.log(studyReport(plan, summarize(plan, results), results, units));
  if (csvPath) {
    writeFileSync(csvPath, studyCsv(plan, results, units));
    console.log(`\nWrote ${results.length} rows to ${csvPath}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "study") return study(args);
  console.error(USAGE);
  return 2;
}

process.exitCode = await main();
