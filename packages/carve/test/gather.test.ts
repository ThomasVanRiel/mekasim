import { simulate } from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import { runTouches, sampleTimes } from "../src/gather.ts";
import { addRun, emptyGrid, emptyRun, mergeGrid, parseKey, tally } from "../src/grid.ts";
import { partOfBody, partsOf } from "../src/parts.ts";
import { LEVER, PUSHED } from "./models.ts";

const CELL = 0.0005;

describe("the parts of a model", () => {
  it("are its shaped bodies that a contact touches, one for each outline", () => {
    const twins = PUSHED.replace(
      'shape: { path: "M 0 0 H 10 V 20 H 0 Z" }',
      'shape: { path: "M 0 0 H 20 V 20 H 0 Z" }',
    );
    const parts = partsOf(simulate(twins));
    // The pusher drawn as the block is: one part, made of both.
    expect(parts.map(({ name, bodies }) => [name, bodies])).toEqual([
      ["ground", ["ground"]],
      ["pusher", ["pusher", "block"]],
    ]);
    expect(partOfBody(parts).get("block")).toBe("pusher");
  });

  it("leave out a body that nothing touches", () => {
    const parts = partsOf(simulate(PUSHED.replace("  push: { between: [pusher, block] }\n", "")));
    expect(parts.map(({ name }) => name)).toEqual(["ground", "block"]);
  });
});

describe("where a run touches the parts", () => {
  it("weighs each sample by the time it stands for", () => {
    expect(Array.from(sampleTimes([0, 1, 3, 4]))).toEqual([0.5, 1.5, 1.5, 0.5]);
    expect(Array.from(sampleTimes([2]))).toEqual([0]);
  });

  it("puts the lever's touches on its top face and the bar's on its lower one", () => {
    const simulation = simulate(LEVER);
    const found = runTouches(simulation, partOfBody(partsOf(simulation)), CELL);
    const lever = found.get("lever");
    const bar = found.get("bar");
    for (const key of lever?.pressed.keys() ?? []) {
      // The top face at 5 mm: in the cell from 5 mm up, or just under it. Tilted up, the
      // bar's corner meets it a little beyond 85 mm out.
      const [i, j] = parseKey(key);
      expect([9, 10]).toContain(j);
      expect(i * CELL).toBeGreaterThanOrEqual(0.0745);
      expect(i * CELL).toBeLessThan(0.0875);
    }
    for (const key of bar?.pressed.keys() ?? []) expect([-1, 0]).toContain(parseKey(key)[1]);
    // All of it, force times time, is the contact's force over the run.
    const contact = simulation.loads?.contacts.rest as Float64Array;
    const times = sampleTimes(simulation.cycle?.t ?? []);
    const whole = Array.from(contact).reduce((sum, force, k) => sum + force * times[k], 0);
    const sum = (map: Map<string, number> | undefined) =>
      [...(map?.values() ?? [])].reduce((a, b) => a + b, 0);
    expect(sum(lever?.pressed)).toBeCloseTo(whole, 9);
    expect(sum(bar?.pressed)).toBeCloseTo(whole, 9);
    expect(lever?.jammed.size).toBe(0);
  });

  it("marks where a run jammed: the block's back on the pusher, its front on the wall", () => {
    const simulation = simulate(PUSHED.replace("to: 40 mm", "to: 80 mm"));
    expect(simulation.jam).toBeDefined();
    const found = runTouches(simulation, partOfBody(partsOf(simulation)), CELL);
    const block = [...(found.get("block")?.jammed ?? [])].map((key) => parseKey(key)[0]);
    // At 0 and 20 mm in the block's own frame, in the cell either side of each.
    expect(block.some((i) => i === -1 || i === 0)).toBe(true);
    expect(block.some((i) => i === 39 || i === 40)).toBe(true);
    for (const i of block) expect([-1, 0, 39, 40]).toContain(i);
    const wall = [...(found.get("ground")?.jammed ?? [])].map((key) => parseKey(key)[0]);
    expect(wall.length).toBeGreaterThan(0);
    for (const i of wall) expect([199, 200]).toContain(i);
  });
});

describe("a grid of cells", () => {
  it("counts each run once in a cell, however many times it touched it", () => {
    const grid = emptyGrid(CELL);
    const run = emptyRun();
    run.pressed.set("1,2", 0.5);
    run.pressed.set("3,4", 0.25);
    run.jammed.add("5,6");
    addRun(grid, run, false);
    addRun(grid, run, false);
    addRun(grid, run, true);
    expect(grid.cells.get("1,2")).toEqual({
      passed: 1,
      failed: 2,
      jammed: 0,
      pressPassed: 0.5,
      pressFailed: 1,
    });
    expect(grid.cells.get("5,6")?.jammed).toBe(3);
    expect(tally(grid)).toEqual({ onlyFailed: 1, both: 2, onlyPassed: 0 });
  });

  it("adds two grids of one cell size, and refuses two of different sizes", () => {
    const a = emptyGrid(CELL);
    const b = emptyGrid(CELL);
    const run = emptyRun();
    run.pressed.set("0,0", 1);
    addRun(a, run, true);
    addRun(b, run, false);
    mergeGrid(a, b);
    expect(a.cells.get("0,0")).toMatchObject({ passed: 1, failed: 1, pressPassed: 1 });
    expect(() => mergeGrid(a, emptyGrid(2 * CELL))).toThrow();
  });
});
