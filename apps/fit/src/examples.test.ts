import { describe, expect, it } from "vitest";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples.ts";

describe("mekafit's example picker", () => {
  it("contains mekafit examples from its own directory", () => {
    expect(EXAMPLES.map(({ id }) => id)).toEqual([
      "clearance-check",
      "coupler-trial",
      "door-latch",
      "knuckle-coupler",
      "push-latch",
      "ratchet",
      "sprung-lever",
    ]);
    expect(EXAMPLES.every(({ text }) => text.includes("mekafit: 1"))).toBe(true);
    expect(DEFAULT_EXAMPLE.id).toBe("clearance-check");
  });

  it("brings the drawings an example names along with it", () => {
    const coupler = EXAMPLES.find(({ id }) => id === "coupler-trial");
    expect([...(coupler?.files.keys() ?? [])].sort()).toEqual(["coupler-base.dxf", "coupler.dxf"]);
  });
});
