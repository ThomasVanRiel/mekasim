import type { Point } from "@mekasim/core";
import type { FitSimulation } from "@mekasim/fit";
import { cellKey, cellOf, emptyGrid, emptyRun, type RunTouches } from "./grid.ts";

/**
 * How long each sample of a run stands for: half the time to the one before and half
 * to the one after. Samples are added where the parts move fast, so counting them
 * alone would weigh those moments more.
 */
export function sampleTimes(t: ArrayLike<number>): Float64Array {
  const n = t.length;
  const times = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const before = k > 0 ? (t[k] as number) - (t[k - 1] as number) : 0;
    const after = k < n - 1 ? (t[k + 1] as number) - (t[k] as number) : 0;
    times[k] = (before + after) / 2;
  }
  return times;
}

/**
 * Where one run touched each part, cell by cell, with how hard and how long, and where
 * it jammed. `partOf` names the part each body is made of; bodies of no part are left out.
 */
export function runTouches(
  simulation: FitSimulation,
  partOf: Map<string, string>,
  size: number,
): Map<string, RunTouches> {
  const found = new Map<string, RunTouches>();
  const grid = emptyGrid(size);
  const runOf = (part: string): RunTouches => {
    let run = found.get(part);
    if (!run) {
      run = emptyRun();
      found.set(part, run);
    }
    return run;
  };
  const key = (place: Point): string => cellKey(...cellOf(grid, place));

  const t = simulation.cycle?.t ?? [];
  const times = sampleTimes(t);
  simulation.touches.forEach((sample, k) => {
    const time = times[k] as number;
    for (const touch of sample) {
      touch.between.forEach((body, side) => {
        const part = partOf.get(body);
        if (!part) return;
        const pressed = runOf(part).pressed;
        const at = key(touch.places[side] as Point);
        pressed.set(at, (pressed.get(at) ?? 0) + touch.force * time);
      });
    }
  });
  for (const row of simulation.jam?.rows ?? []) {
    if (row.kind !== "contact" || !row.between || !row.places) continue;
    row.between.forEach((body, side) => {
      const part = partOf.get(body);
      if (part) runOf(part).jammed.add(key(row.places?.[side] as Point));
    });
  }
  return found;
}
