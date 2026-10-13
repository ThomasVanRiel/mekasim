import { describe, expect, it } from "vitest";
import { checkOutcome, checkSummary } from "./checks.ts";

describe("how a check came out", () => {
  it("is met or not met", () => {
    expect(checkOutcome({ id: "a", holds: true }, 360)).toEqual({ state: "met" });
    expect(checkOutcome({ id: "a", holds: false }, 360)).toEqual({ state: "not met" });
  });

  it("says where a check that varies is not met, and gives a step to show", () => {
    expect(checkOutcome({ id: "a", holds: false, fails: { count: 12, first: 40 } }, 360)).toEqual({
      state: "not met",
      where: "At 12 of 360 steps, first at step 40.",
      step: 40,
    });
    expect(checkOutcome({ id: "a", holds: false, fails: { count: 90, first: 0 } }, 90).where).toBe(
      "At every step.",
    );
  });

  it("is not available when the check could not be worked out", () => {
    expect(checkOutcome({ id: "a", error: "Unknown name" }, 360)).toEqual({
      state: "not available",
    });
    expect(checkOutcome(undefined, 360)).toEqual({ state: "not available" });
  });
});

describe("the summary of the checks", () => {
  it("counts those that are met", () => {
    expect(checkSummary([])).toBe("");
    expect(checkSummary([{ id: "a", holds: true }])).toBe("All met");
    expect(
      checkSummary([
        { id: "a", holds: true },
        { id: "b", holds: false },
        { id: "c", error: "x" },
      ]),
    ).toBe("1 of 3 met");
  });
});
