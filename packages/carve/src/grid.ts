import type { Point } from "@mekasim/core";

/** What one cell of a part has gathered over a study's runs. */
export interface Cell {
  /** How many passing runs, failing runs and jammed runs touched it. */
  passed: number;
  failed: number;
  jammed: number;
  /** How hard and how long it was pressed in passing and in failing runs: force times time, N*s. */
  pressPassed: number;
  pressFailed: number;
}

/**
 * Cells of one part, square, `size` metres on a side, in the part's own frame. Cell
 * (i, j) covers i * size to (i + 1) * size across and the same up. Only cells that
 * were touched are kept.
 */
export interface TouchGrid {
  size: number;
  cells: Map<string, Cell>;
}

export function emptyGrid(size: number): TouchGrid {
  return { size, cells: new Map() };
}

export function cellOf(grid: TouchGrid, [x, y]: Point): [i: number, j: number] {
  return [Math.floor(x / grid.size), Math.floor(y / grid.size)];
}

export const cellKey = (i: number, j: number): string => `${i},${j}`;

export function parseKey(key: string): [i: number, j: number] {
  const [i, j] = key.split(",").map(Number);
  return [i as number, j as number];
}

function cellAt(grid: TouchGrid, key: string): Cell {
  let cell = grid.cells.get(key);
  if (!cell) {
    cell = { passed: 0, failed: 0, jammed: 0, pressPassed: 0, pressFailed: 0 };
    grid.cells.set(key, cell);
  }
  return cell;
}

/**
 * What one run left on a part: where it touched, with how hard and how long, and
 * where it jammed. Added to a grid with `addRun`, so that each cell counts a run once.
 */
export interface RunTouches {
  pressed: Map<string, number>;
  jammed: Set<string>;
}

export function emptyRun(): RunTouches {
  return { pressed: new Map(), jammed: new Set() };
}

export function addRun(grid: TouchGrid, run: RunTouches, passed: boolean): void {
  for (const [key, press] of run.pressed) {
    const cell = cellAt(grid, key);
    if (passed) {
      cell.passed++;
      cell.pressPassed += press;
    } else {
      cell.failed++;
      cell.pressFailed += press;
    }
  }
  for (const key of run.jammed) cellAt(grid, key).jammed++;
}

/** Add what `from` gathered to `into`; both of one cell size. */
export function mergeGrid(into: TouchGrid, from: TouchGrid): void {
  if (into.size !== from.size) throw new Error("Grids of different cell sizes cannot be merged");
  for (const [key, cell] of from.cells) {
    const to = cellAt(into, key);
    to.passed += cell.passed;
    to.failed += cell.failed;
    to.jammed += cell.jammed;
    to.pressPassed += cell.pressPassed;
    to.pressFailed += cell.pressFailed;
  }
}

/** How the cells of a part divide: touched only in failing runs, in both, only in passing ones. */
export function tally(grid: TouchGrid): { onlyFailed: number; both: number; onlyPassed: number } {
  let onlyFailed = 0;
  let both = 0;
  let onlyPassed = 0;
  for (const cell of grid.cells.values()) {
    // A run that jams fails.
    const failed = cell.failed > 0 || cell.jammed > 0;
    if (failed && cell.passed > 0) both++;
    else if (failed) onlyFailed++;
    else if (cell.passed > 0) onlyPassed++;
  }
  return { onlyFailed, both, onlyPassed };
}
