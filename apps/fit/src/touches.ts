import type { FitSimulation } from "@mekasim/fit";
import { loadText } from "./springs.ts";

/** One place where two parts touch at the shown step, as the sheet draws it. */
export interface TouchMark {
  key: string;
  /** The body it is drawn on, by name, and where on it, in its own frame. */
  body: string;
  u: number;
  v: number;
  /** How hard they press there, against the hardest anywhere in the run: 0 to 1. */
  share: number;
  /** What it is, for its tooltip. */
  text: string;
}

/**
 * Where the parts touch at a step of the run. Each place is drawn on the first body
 * of its contact; the second is within a micrometre of it.
 */
export function touchesAt(simulation: FitSimulation | undefined, step: number): TouchMark[] {
  const units = simulation?.compiled?.units;
  const all = simulation?.touches ?? [];
  if (!units || all.length === 0) return [];
  const k = Math.min(all.length - 1, Math.max(0, Math.round(step)));
  let hardest = 0;
  for (const sample of all) for (const { force } of sample) hardest = Math.max(hardest, force);
  return (all[k] ?? []).map((touch, i) => {
    const [a, b] = touch.between;
    const [u, v] = touch.places[0];
    return {
      key: `${touch.contact} ${i}`,
      body: a,
      u,
      v,
      share: hardest > 0 ? touch.force / hardest : 0,
      text: `${a} on ${b}: ${touch.force > 0 ? loadText(touch.force, false, units) : "not pressing"}`,
    };
  });
}
