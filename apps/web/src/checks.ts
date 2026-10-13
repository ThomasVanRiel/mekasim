import type { CheckResult } from "@mekasim/core";

/** How a check came out, in the words the panel shows. */
export interface CheckOutcome {
  state: "met" | "not met" | "not available";
  /** Where a check that varies over the cycle is not met. */
  where?: string;
  /** A step at which it is not met, to show on the drawing. */
  step?: number;
}

export function checkOutcome(check: CheckResult | undefined, steps: number): CheckOutcome {
  if (check?.holds === undefined) return { state: "not available" };
  if (check.holds) return { state: "met" };
  const { fails } = check;
  if (!fails) return { state: "not met" };
  return {
    state: "not met",
    where:
      fails.count === steps
        ? "At every step."
        : `At ${fails.count} of ${steps} steps, first at step ${fails.first}.`,
    step: fails.first,
  };
}

/** How many of the checks are met, as a line for the head of the panel. */
export function checkSummary(checks: CheckResult[]): string {
  if (checks.length === 0) return "";
  const met = checks.filter((check) => check.holds).length;
  return met === checks.length ? "All met" : `${met} of ${checks.length} met`;
}
