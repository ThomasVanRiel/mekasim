import { describe, expect, it } from "vitest";
import { parseKey, tally } from "../src/grid.ts";
import { gatherInThreads } from "../src/node.ts";
import { touchSvg } from "../src/svg.ts";
import { type FromGatherer, gatherer } from "../src/worker.ts";
import { PUSHED } from "./models.ts";

const CELL = 0.0005;

describe("gathering a study's touches", () => {
  it("judges each run as a study does and puts what it touched on the parts", () => {
    const handle = gatherer();
    const ready = handle({ kind: "start", text: PUSHED, study: "far", cell: CELL });
    expect(ready).toMatchObject({ kind: "ready", runs: 2 });
    const done = handle({ kind: "runs", indices: [0, 1] }) as Extract<
      FromGatherer,
      { kind: "results" }
    >;
    // Pushed to 40 mm it stays clear; pushed to 80 mm it jams against the wall.
    expect(done.results.map(({ outcome }) => outcome)).toEqual(["passed", "failed"]);
    const block = done.grids.get("block");
    const back = [...(block?.cells ?? [])].filter(([key]) => parseKey(key)[0] <= 0);
    const front = [...(block?.cells ?? [])].filter(([key]) => parseKey(key)[0] >= 39);
    // Both runs push its back; only the one that fails reaches the wall with its front.
    expect(back.every(([, cell]) => cell.passed === 1 && cell.failed === 1)).toBe(true);
    expect(front.length).toBeGreaterThan(0);
    expect(front.every(([, cell]) => cell.passed === 0 && cell.failed + cell.jammed > 0)).toBe(
      true,
    );
    expect(tally(done.grids.get("ground") ?? { size: CELL, cells: new Map() }).onlyPassed).toBe(0);
  });

  it("says why when the study is not there", () => {
    expect(gatherer()({ kind: "start", text: PUSHED, study: "near", cell: CELL })).toEqual({
      kind: "error",
      message: 'There is no study "near"; the model has "far"',
    });
  });

  it("comes to the same in worker threads", async () => {
    const files = new Map<string, string>();
    const gathered = await gatherInThreads(PUSHED, files, "far", 2, CELL, { threads: 2 });
    expect(gathered.results.map(({ index, outcome }) => [index, outcome])).toEqual([
      [0, "passed"],
      [1, "failed"],
    ]);
    expect(gathered.parts.map(({ name }) => name)).toEqual(["ground", "pusher", "block"]);
    const handle = gatherer();
    handle({ kind: "start", text: PUSHED, study: "far", cell: CELL });
    const alone = handle({ kind: "runs", indices: [0, 1] }) as Extract<
      FromGatherer,
      { kind: "results" }
    >;
    for (const [name, grid] of alone.grids) {
      const cells = [...(gathered.grids.get(name)?.cells ?? [])].sort();
      const expected = [...grid.cells].sort();
      expect(cells.map(([key, cell]) => [key, cell.passed, cell.failed, cell.jammed])).toEqual(
        expected.map(([key, cell]) => [key, cell.passed, cell.failed, cell.jammed]),
      );
    }
  }, 30_000);

  it("draws a part with its outline and its touched cells, blue where runs passed, red where they failed", async () => {
    const files = new Map<string, string>();
    const { parts, grids } = await gatherInThreads(PUSHED, files, "far", 2, CELL, {
      threads: 1,
    });
    const part = parts.find(({ name }) => name === "block");
    const grid = grids.get("block");
    if (!part || !grid) throw new Error("No block");
    const svg = touchSvg(part, grid, { passed: 1, failed: 1 });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('<path d="M 0 0');
    const dots = svg.match(/<circle [^>]*fill="#/g) ?? [];
    const red = svg.match(/fill="#c2362c"/g) ?? [];
    let passedCells = 0;
    let failedCells = 0;
    for (const cell of grid.cells.values()) {
      if (cell.passed > 0) passedCells++;
      if (cell.failed > 0) failedCells++;
    }
    // A dot for each kind of run that touched a cell; rings where runs jammed are not filled.
    expect(dots.length).toBe(passedCells + failedCells);
    expect(red.length).toBe(failedCells);
    expect(svg).toContain("block: where 1 passing and 1 failing runs touched it");
  }, 30_000);
});
