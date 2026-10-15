import type { Units } from "@mekasim/core";
import { type StudyPlan, shownValue } from "./plan.ts";
import type { RunResult } from "./run.ts";
import type { StudySummary } from "./stats.ts";

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a study came to, as the command line prints it. */
export function studyReport(
  plan: StudyPlan,
  summary: StudySummary,
  results: RunResult[],
  units: Units,
): string {
  const lines: string[] = [];
  const solved = summary.passed + summary.failed;
  const { rate } = summary;
  lines.push(
    solved > 0
      ? `Passed ${summary.passed} of ${solved}: ${percent(rate.share)}, 95% range ${percent(rate.low)} to ${percent(rate.high)}`
      : "No run could be solved",
  );
  if (summary.unsolved > 0) {
    lines.push(`Could not be solved: ${plural(summary.unsolved, "run")}`);
    const byMessage = new Map<string, number[]>();
    for (const { outcome, message, index } of results) {
      if (outcome !== "unsolved") continue;
      const key = message ?? "";
      byMessage.set(key, [...(byMessage.get(key) ?? []), index]);
    }
    for (const [message, indices] of byMessage) {
      const shown = indices.slice(0, 8).join(", ") + (indices.length > 8 ? ", …" : "");
      lines.push(`  ${message} (${indices.length === 1 ? "run" : "runs"} ${shown})`);
    }
  }

  if (summary.failures.length > 0) {
    lines.push("", "Not met");
    const width = Math.max(...summary.failures.map(({ condition }) => condition.length));
    for (const { condition, count } of summary.failures) {
      lines.push(`  ${condition.padEnd(width)}  in ${plural(count, "run")}`);
    }
  }

  if (solved > 0 && plan.varied.length > 0) {
    lines.push("", "Passed over each range");
    for (const rates of summary.parameters) {
      const varied = plan.varied.find(({ name }) => name === rates.name);
      if (!varied) continue;
      const show = (value: number): string => shownValue(value, varied.dim, units);
      const filled = rates.bins.filter((bin) => bin.passed + bin.failed > 0);
      const share = (bin: (typeof rates.bins)[number]): string =>
        bin.passed + bin.failed > 0 ? percent(bin.passed / (bin.passed + bin.failed)) : "-";
      if (varied.range.kind === "pick") {
        const each = rates.bins.map((bin) => `${show(bin.from)}: ${share(bin)}`).join(", ");
        lines.push(`  ${rates.name}  ${each}`);
      } else if (filled.length > 0) {
        const first = rates.bins[0] as (typeof rates.bins)[number];
        const last = rates.bins.at(-1) as (typeof rates.bins)[number];
        const shares = rates.bins.map((bin) => share(bin).padStart(4)).join(" ");
        lines.push(`  ${rates.name}  from ${show(first.from)} to ${show(last.to)}:${shares}`);
      }
    }
    if (plan.varied.length > 1 && summary.telling.length > 0) {
      lines.push(`Matters most: ${summary.telling.join(" and ")}`);
    }
  }
  return lines.join("\n");
}

/** A field of a CSV row, quoted when it contains a comma, a quote or a line break. */
function field(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Every run as a row: its number, its values in the model's units, its outcome and why. */
export function studyCsv(plan: StudyPlan, results: RunResult[], units: Units): string {
  const header = [
    "run",
    ...plan.varied.map(({ name, dim }) => {
      const label = shownValue(1, dim, units).replace(/^\S+\s*/, "");
      return label ? `${name} (${label})` : name;
    }),
    "outcome",
    "not met",
    "message",
  ];
  const rows = results.map((result) => [
    String(result.index),
    ...plan.varied.map(({ name, dim }) =>
      shownValue(result.values[name] as number, dim, units, 9).replace(/\s.*$/, ""),
    ),
    result.outcome,
    result.failed.join(" "),
    result.message ?? "",
  ]);
  return `${[header, ...rows].map((row) => row.map(field).join(",")).join("\n")}\n`;
}
