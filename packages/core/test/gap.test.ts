import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gap, poseOf, type Shape, simulate } from "../src/index.ts";

const example = readFileSync(
  new URL("../../../examples/shaped-four-bar.mekasim.yaml", import.meta.url),
  "utf8",
);
const withMeasures = (measures: string): string =>
  example.replace("  rocker_swing:", `  ${measures}\n  rocker_swing:`);
const said = (text: string) =>
  simulate(text).diagnostics.map((d) => [d.severity, d.message, d.path?.join(".")]);
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

  it("can be asked of the ground, which stays where the sheet is", () => {
    const grounded = example.replace(
      "    points: { O2: [0, 0], O4: [180, 0] }",
      '    points: { O2: [0, 0], O4: [180, 0] }\n    shape: { path: "M -30 -60 H 210 V -52 H -30 Z" }',
    );
    const floor = (measure: string) =>
      simulate(grounded.replace("  rocker_swing:", `  floor: ${measure}\n  rocker_swing:`));
    // The crank's tip reaches 49 mm down from its shaft, and the floor's top is 52 mm down.
    const clear = floor("min(gap(ground, coupler))");
    expect(clear.diagnostics).toEqual([]);
    expect(clear.measures.find((m) => m.id === "floor")?.quantity?.value).toBeCloseTo(0.003, 9);
  });

  it("is less than nothing where two bodies run into each other, by how deep", () => {
    // A block standing in the way of the rocker's far end.
    const blocked = example.replace(
      "    points: { O2: [0, 0], O4: [180, 0] }",
      '    points: { O2: [0, 0], O4: [180, 0] }\n    shape: { path: "M 100 100 H 140 V 140 H 100 Z" }',
    );
    const simulation = simulate(
      blocked.replace("  rocker_swing:", "  deepest: min(gap(ground, coupler))\n  rocker_swing:"),
    );
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.measures.find((m) => m.id === "deepest")?.quantity?.value).toBeLessThan(
      -0.001,
    );
  });

  it("is kept with the two places it is between, each pair once, for drawing", () => {
    const asked = simulate(
      withMeasures("tightest: min(gap(crank, rocker))\n  again: gap(rocker, crank) * 2").replace(
        "  rocker: angle(rocker)",
        "  rocker: angle(rocker)\n  clear: gap(coupler, ground)",
      ),
    );
    // The ground has no shape here, so the plot is an error and gives no gap.
    expect(asked.gaps.map(({ a, b, asked: where }) => [a, b, where.join(".")])).toEqual([
      ["crank", "rocker", "measures.tightest"],
    ]);
    const [found] = asked.gaps;
    expect(found?.gaps).toHaveLength(asked.cycle?.count as number);
    expect(found?.pinned).toBe(false);
    const first = found?.gaps[0];
    expect(
      Math.hypot((first?.a[0] ?? 0) - (first?.b[0] ?? 0), (first?.a[1] ?? 0) - (first?.b[1] ?? 0)),
    ).toBeCloseTo(first?.distance as number, 12);
    expect(simulate(example).gaps).toEqual([]);
  });

  it("says what is wrong with what it is asked", () => {
    expect(messages(withMeasures("clear: gap(crank)"))).toEqual(["gap() takes 2 bodies, got 1"]);
    expect(messages(withMeasures("clear: gap(crank, 2)"))).toEqual([
      "gap() takes the names of two bodies, as in gap(crank, frame)",
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
});

describe("the gap between two bodies joined by a pin", () => {
  const pinned = simulate(withMeasures("over: gap(crank, coupler)\n  least: min(over)"));

  it("is never less than nothing: where they lie over each other is not counted", () => {
    const [found] = pinned.gaps;
    expect(found?.pinned).toBe(true);
    expect(found?.over).toBe(pinned.cycle?.count);
    expect(pinned.measures.find((m) => m.id === "least")?.quantity?.value).toBe(0);
  });

  it("is warned about once, where it is first asked for", () => {
    expect(
      said(withMeasures("over: gap(crank, coupler)\n  least: min(gap(coupler, crank))")),
    ).toEqual([
      [
        "warning",
        '"crank" and "coupler" are joined by a pin, so where they lie over each other is not counted, and gap() gives 0 there. To measure the gap between them, draw them clear of each other round the pin',
        "measures.over",
      ],
    ]);
  });

  it("is measured as any other where they are drawn clear of each other", () => {
    // A coupler that starts beyond the crank's round end, its pin outside its own outline.
    const clear = withMeasures("play: min(gap(crank, coupler))").replace(
      'path: "M 0 -9 L 160 -9 A 9 9 0 0 1 160 9 L 104 9 L 89 60 A 9 9 0 0 1 71 60 L 56 9 L 0 9 A 9 9 0 0 1 0 -9 Z"\n      holes: { A: pin, B: pin, P: 4 }',
      'path: "M 60 -9 L 160 -9 A 9 9 0 0 1 160 9 L 60 9 Z"\n      holes: { B: pin }',
    );
    const simulation = simulate(clear);
    expect(simulation.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(simulation.gaps[0]?.pinned).toBe(true);
    expect(simulation.gaps[0]?.over).toBe(0);
    expect(simulation.measures.find((m) => m.id === "play")?.quantity?.value).toBeGreaterThan(0);
  });
});
