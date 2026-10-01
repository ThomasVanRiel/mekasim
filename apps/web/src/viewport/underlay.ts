import type { Underlay } from "../store.ts";
import type { Bounds } from "./scene.ts";

/** Lay a new picture over the middle of the drawing, a little wider than the model. */
export function placeUnderlay(
  image: { url: string; width: number; height: number },
  bounds: Bounds,
): Underlay {
  const span = (bounds.maxX - bounds.minX) * 1.2;
  return {
    ...image,
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale: span / image.width,
    opacity: 0.6,
  };
}

/**
 * Resize the picture so that two places picked on it are a known distance apart.
 * The first place stays where it is on the sheet. Positions and distance in metres.
 */
export function rescaleUnderlay(
  underlay: Underlay,
  a: { x: number; y: number },
  b: { x: number; y: number },
  distance: number,
): Underlay {
  const picked = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(picked > 0) || !(distance > 0)) return underlay;
  const factor = distance / picked;
  return {
    ...underlay,
    scale: underlay.scale * factor,
    x: a.x + (underlay.x - a.x) * factor,
    y: a.y + (underlay.y - a.y) * factor,
  };
}
