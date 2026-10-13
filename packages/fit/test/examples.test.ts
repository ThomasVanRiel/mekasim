import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";

const DIRECTORY = new URL("../../../examples/fit/", import.meta.url);
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith(".mekafit.yaml"));
const read = (file: string): string => readFileSync(new URL(file, DIRECTORY), "utf8");

describe("mekafit's examples", () => {
  for (const file of files) {
    it(`solves ${file}`, () => {
      const result = simulate(read(file));
      expect(result.diagnostics).toEqual([]);
      expect(result.cycle?.count).toBeGreaterThan(1);
      expect(result.checks.every(({ holds }) => holds)).toBe(true);
    });
  }

  it("has a sprung lever that gives way under a bar and follows it back", () => {
    const result = simulate(read("sprung-lever.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    // Flat under the bar at its lowest; at its highest the bar's corner is 15 mm up, 85 mm out.
    expect(value("lowest")).toBeCloseTo(0, 8);
    expect(value("highest")).toBeCloseTo(
      Math.acos(0.005 / Math.hypot(0.015, 0.085)) - Math.atan2(0.085, 0.015),
      8,
    );
    expect(result.cycle?.count).toBe(81);
  });

  it("has a motor-driven clearance check with its hand-worked closest gap", () => {
    const result = simulate(read("clearance-check.mekafit.yaml"));
    const tightest = result.measures.find(({ id }) => id === "tightest")?.quantity?.value;
    expect(tightest).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.smallest.distance).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.step).toBe(36);
  });
});
