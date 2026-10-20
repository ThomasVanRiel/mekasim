import { type Shape, writePath } from "@mekasim/core";
import type { FitSimulation } from "@mekasim/fit";

/**
 * A part to be carved: one outline, and the bodies that are made of it. Bodies whose
 * outlines are the same in their own frames, as two copies of one drawing placed the
 * same way are, are one part, so what touches any of them goes onto one grid.
 */
export interface Part {
  /** Named after the first of its bodies. */
  name: string;
  shape: Shape;
  bodies: string[];
}

/** The parts of a solved model that any of its contacts touch, in the order of its bodies. */
export function partsOf(simulation: FitSimulation): Part[] {
  const compiled = simulation.compiled;
  if (!compiled) return [];
  const touched = new Set(compiled.contacts.flatMap(({ a, b }) => [a, b]));
  const byOutline = new Map<string, Part>();
  for (const body of compiled.bodies.values()) {
    if (!body.shape || !touched.has(body.id)) continue;
    // To a nanometre: what is drawn the same is the same.
    const key = writePath([body.shape.outer, ...body.shape.holes], 9);
    const found = byOutline.get(key);
    if (found) found.bodies.push(body.id);
    else byOutline.set(key, { name: body.id, shape: body.shape, bodies: [body.id] });
  }
  return [...byOutline.values()];
}

/** Which part each body is made of, by name. */
export function partOfBody(parts: Part[]): Map<string, string> {
  return new Map(parts.flatMap((part) => part.bodies.map((body) => [body, part.name] as const)));
}
