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

  it("has a door latch whose bolt is pushed back by the strike and then holds the door", () => {
    const result = simulate(read("door-latch.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    // The strike's corner rides the 45 degree slant of the nose for its 8 mm of height.
    expect(value("furthest_in")).toBeCloseTo(-0.008, 8);
    // Pulled with 20 N, the door is held by the bolt's back on the strike with the same.
    expect(value("holding")).toBeCloseTo(20, 5);
    expect(result.free).toEqual([]);
    const { cycle, compiled } = result;
    const door = 3 * (compiled?.bodies.get("door")?.index as number);
    expect(cycle?.q[((cycle?.count ?? 1) - 1) * cycle.width + door]).toBeCloseTo(0.07, 8);
  });

  it("has a ratchet whose pawl drops behind two teeth and then holds the wheel", () => {
    const result = simulate(read("ratchet.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    const pawl = value("pawl") as Float64Array;
    const wheel = value("wheel") as Float64Array;
    // The pawl rides up each tooth and falls off its end: twice in 100 degrees of 45 degree teeth.
    let drops = 0;
    for (let k = 1; k < pawl.length; k++) {
      if ((pawl[k] as number) - (pawl[k - 1] as number) < -0.05) drops++;
    }
    expect(drops).toBe(2);
    // Let go, the wheel comes back until the tooth it last passed, 90 degrees round, meets the pawl.
    const end = ((wheel.at(-1) as number) * 180) / Math.PI;
    expect(end).toBeGreaterThan(-86);
    expect(end).toBeLessThan(-84);
    expect(wheel.at(-1)).toBeCloseTo(wheel.at(-20) as number, 9);
    expect(value("holding")).toBeGreaterThan(2);
    expect(result.free).toEqual([]);
  });

  it("has a motor-driven clearance check with its hand-worked closest gap", () => {
    const result = simulate(read("clearance-check.mekafit.yaml"));
    const tightest = result.measures.find(({ id }) => id === "tightest")?.quantity?.value;
    expect(tightest).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.smallest.distance).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.step).toBe(36);
  });
});
