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

  it("has a motor-driven clearance check with its hand-worked closest gap", () => {
    const result = simulate(read("clearance-check.mekafit.yaml"));
    const tightest = result.measures.find(({ id }) => id === "tightest")?.quantity?.value;
    expect(tightest).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.smallest.distance).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.step).toBe(36);
  });
});
