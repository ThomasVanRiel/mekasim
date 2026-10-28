import { describe, expect, it } from "vitest";
import { analyticsScript } from "./analytics.ts";

describe("analytics", () => {
  it("are off unless the build names a script", () => {
    expect(analyticsScript(undefined)).toBeUndefined();
    expect(analyticsScript(" ")).toBeUndefined();
    expect(analyticsScript(" https://stats.example/js/pa-x.js ")).toBe(
      "https://stats.example/js/pa-x.js",
    );
  });
});
