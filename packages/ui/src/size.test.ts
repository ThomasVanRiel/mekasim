import { describe, expect, it } from "vitest";
import { clamp } from "./size.ts";

describe("panel sizes", () => {
  it("are kept within what a panel can usefully be", () => {
    expect(clamp(50, 220, 800)).toBe(220);
    expect(clamp(900, 220, 800)).toBe(800);
    expect(clamp(333.6, 220, 800)).toBe(334);
    // A window too small for the usual limits still gives the smallest size.
    expect(clamp(300, 220, 100)).toBe(220);
  });
});
