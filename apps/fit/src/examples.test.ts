import { describe, expect, it } from "vitest";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples.ts";

describe("mekafit's example picker", () => {
  it("contains mekafit examples from its own directory", () => {
    expect(EXAMPLES.map(({ id }) => id)).toEqual([
      "clearance-check",
      "door-latch",
      "ratchet",
      "sprung-lever",
    ]);
    expect(EXAMPLES.every(({ text }) => text.includes("mekafit: 1"))).toBe(true);
    expect(DEFAULT_EXAMPLE.id).toBe("clearance-check");
  });
});
