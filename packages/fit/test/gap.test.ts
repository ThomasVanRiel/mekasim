import { readFileSync } from "node:fs";
import { type Shape, simulate as simulateModel } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { gap, gapsOf, poseOf, simulate } from "../src/index.ts";

const example = readFileSync(
  new URL("../../../examples/shaped-four-bar.mekasim.yaml", import.meta.url),
  "utf8",
).replace("mekasim: 1", "mekafit: 1");
const withMeasures = (measures: string): string =>
  example.replace("  rocker_swing:", `  ${measures}\n  rocker_swing:`);
const messages = (text: string): string[] => simulate(text).diagnostics.map((d) => d.message);

describe("gap() in a model's expressions", () => {
  const simulation = simulate(
    withMeasures("clear: gap(crank, rocker)\n  tightest: min(gap(crank, rocker))"),
  );
  const value = (id: string) => simulation.measures.find((m) => m.id === id)?.quantity;

  it("is the distance between two bodies' shapes at every sample, as a length", () => {
    expect(simulation.diagnostics).toEqual([]);
    const clear = value("clear");
    expect(clear?.dim).toEqual([1, 0, 0, 0]);
    const distances = clear?.value as Float64Array;
    expect(distances).toHaveLength(simulation.cycle?.count as number);
    const { compiled, cycle } = simulation;
    if (!compiled || !cycle) throw new Error("not solved");
    const crank = compiled.bodies.get("crank");
    const rocker = compiled.bodies.get("rocker");
    if (!crank || !rocker) throw new Error("no such body");
    for (const k of [0, 77, 200, 359]) {
      const found = gap(
        crank.shape as Shape,
        poseOf(crank, cycle, k),
        rocker.shape as Shape,
        poseOf(rocker, cycle, k),
      );
      expect(distances[k]).toBe(found?.distance);
    }
    // The crank reaches 49 mm from its shaft, and the rocker stays well clear of it.
    expect(Math.min(...distances)).toBeGreaterThan(0.02);
    expect(Math.max(...distances)).toBeLessThan(0.2);
  });

  it("reduces as any other signal does", () => {
    const distances = value("clear")?.value as Float64Array;
    expect(value("tightest")?.value).toBe(Math.min(...distances));
  });

  it("is less than nothing for links that lie over each other at their pin", () => {
    const pinned = simulate(withMeasures("over: max(gap(crank, coupler))"));
    expect(pinned.measures.find((m) => m.id === "over")?.quantity?.value).toBeLessThan(-0.001);
  });

  it("can be asked of the ground, which stays where the sheet is", () => {
    const grounded = example.replace(
      "    points: { O2: [0, 0], O4: [180, 0] }",
      '    points: { O2: [0, 0], O4: [180, 0] }\n    shape: { path: "M -30 -60 H 210 V -40 H -30 Z" }',
    );
    const simulation = simulate(
      grounded.replace("  rocker_swing:", "  floor: min(gap(ground, crank))\n  rocker_swing:"),
    );
    expect(simulation.diagnostics).toEqual([]);
    // The crank's tip reaches 49 mm down from its shaft, and the floor's top is 40 mm down.
    expect(simulation.measures.find((m) => m.id === "floor")?.quantity?.value).toBeCloseTo(
      -0.009,
      9,
    );
  });

  it("comes with the two places it is between, for drawing", () => {
    const { compiled, cycle } = simulation;
    if (!compiled || !cycle) throw new Error("not solved");
    const gaps = gapsOf(compiled, cycle, "crank", "rocker");
    expect(gaps).toHaveLength(cycle.count);
    const first = gaps?.[0];
    expect(
      Math.hypot((first?.a[0] ?? 0) - (first?.b[0] ?? 0), (first?.a[1] ?? 0) - (first?.b[1] ?? 0)),
    ).toBeCloseTo(first?.distance as number, 12);
    expect(gapsOf(compiled, cycle, "crank", "ground")).toBeUndefined();
  });

  it("says what is wrong with what it is asked", () => {
    expect(messages(withMeasures("clear: gap(crank)"))).toEqual([
      "gap() takes the names of two bodies, as in gap(knuckle, head), got 1",
    ]);
    expect(messages(withMeasures("clear: gap(crank, 2)"))).toEqual([
      "gap() takes the names of two bodies, as in gap(knuckle, head)",
    ]);
    expect(messages(withMeasures("clear: gap(crank, flywheel)"))).toEqual([
      'Unknown body "flywheel"',
    ]);
    expect(messages(withMeasures("clear: gap(crank, ground)"))).toEqual([
      '"ground" has no shape, so there is no gap to measure to it. Give it one with shape:',
    ]);
    expect(messages(withMeasures("clear: gap(crank, crank)"))).toEqual([
      'gap() is between two bodies, and "crank" is given twice',
    ]);
  });

  it("is mekafit's: mekasim does not know it", () => {
    const inMekasim = withMeasures("clear: gap(crank, rocker)").replace("mekafit: 1", "mekasim: 1");
    expect(simulateModel(inMekasim).diagnostics.map((d) => d.severity)).toEqual(["error"]);
    // Opened in mekafit, a mekasim model can ask for it all the same.
    expect(messages(inMekasim)).toEqual([]);
  });
});
