/** Geometry for the scatter of a study's runs: scales, positions, the point nearest the pointer. */
import { mapper, type Scale, valueScale } from "./geometry.ts";

/** How a run is marked: passed, failed, not solved, or a failure of the run before. */
export type ScatterKind = "passed" | "failed" | "unsolved" | "before";

export interface ScatterPoint {
  /** The run's number. */
  key: number;
  x: number;
  y: number;
  kind: ScatterKind;
  /** Drawn faintly, as when a filter leaves it out. */
  faint?: boolean;
}

export interface ScatterBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ScatterLayout {
  x: Scale;
  y: Scale;
  toX(value: number): number;
  toY(value: number): number;
}

/** The ends of an axis: those given, or as far as the points go. */
function ends(values: number[], given?: [number, number]): [number, number] {
  if (given) return given;
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return Number.isFinite(low) ? [low, high] : [0, 1];
}

/** Scales for both axes over the given ranges, or the points' own, in the box. */
export function scatterLayout(
  points: ScatterPoint[],
  box: ScatterBox,
  xRange?: [number, number],
  yRange?: [number, number],
): ScatterLayout {
  const [xLow, xHigh] = ends(
    points.map(({ x }) => x),
    xRange,
  );
  const [yLow, yHigh] = ends(
    points.map(({ y }) => y),
    yRange,
  );
  const x = valueScale(xLow, xHigh, Math.max(2, (box.right - box.left) / 90));
  const y = valueScale(yLow, yHigh, Math.max(2, (box.bottom - box.top) / 50));
  return {
    x,
    y,
    toX: mapper(x, box.left, box.right),
    toY: mapper(y, box.bottom, box.top),
  };
}

/** The point nearest a place in the box, within `reach` pixels; faint points are passed over. */
export function nearestPoint(
  points: ScatterPoint[],
  layout: ScatterLayout,
  px: number,
  py: number,
  reach = 8,
): ScatterPoint | undefined {
  let best: ScatterPoint | undefined;
  let distance = reach * reach;
  for (const point of points) {
    if (point.faint || point.kind === "before") continue;
    const dx = layout.toX(point.x) - px;
    const dy = layout.toY(point.y) - py;
    const d = dx * dx + dy * dy;
    if (d <= distance) {
      distance = d;
      best = point;
    }
  }
  return best;
}

/**
 * A small offset for a run on an axis that takes only a few values, so that runs at one
 * value do not lie on each other: up to `share` of the gap between the values, the same
 * for a run each time.
 */
export function jitter(key: number, gap: number, share = 0.35): number {
  const golden = (key * 0.6180339887498949) % 1;
  return (golden - 0.5) * share * gap;
}
