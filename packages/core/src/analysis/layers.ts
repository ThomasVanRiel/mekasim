import type { Compiled } from "../compile/compile.ts";
import { convexHull, type Point } from "../geometry/outline.ts";
import { GROUND } from "../schema/document.ts";
import type { Cycle } from "./cycle.ts";

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length, 0), 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function side(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** The sides of a convex shape given by its corners; one or two corners make a point or a line. */
function sides(hull: Point[]): [Point, Point][] {
  if (hull.length === 1) return [[hull[0] as Point, hull[0] as Point]];
  if (hull.length === 2) return [[hull[0] as Point, hull[1] as Point]];
  return hull.map((corner, i) => [corner, hull[(i + 1) % hull.length] as Point]);
}

function contains(hull: Point[], p: Point): boolean {
  return hull.length >= 3 && sides(hull).every(([a, b]) => side(a, b, p) >= 0);
}

/** The gap between two convex shapes; zero when they touch or overlap. */
export function hullDistance(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY;
  if (contains(a, b[0] as Point) || contains(b, a[0] as Point)) return 0;
  let least = Number.POSITIVE_INFINITY;
  for (const [a1, a2] of sides(a)) {
    for (const [b1, b2] of sides(b)) {
      if (segmentsCross(a1, a2, b1, b2)) return 0;
      least = Math.min(
        least,
        pointToSegment(a1, b1, b2),
        pointToSegment(a2, b1, b2),
        pointToSegment(b1, a1, a2),
        pointToSegment(b2, a1, a2),
      );
    }
  }
  return least;
}

/** How many instants of the cycle are looked at for overlap. */
const INSTANTS = 72;

/**
 * Put the bodies on layers so that no two on one layer run into each other. Two
 * bodies are kept apart when they share a joint, or when their plates, `half` wide
 * to each side of their points, overlap at some instant of the cycle. Each body
 * takes the lowest layer that those it must avoid leave free; a layer given in the
 * model is kept as it is.
 */
export function assignLayers(compiled: Compiled, cycle: Cycle, half: number): void {
  const moving = [...compiled.bodies.values()].filter((body) => body.index >= 0);
  const avoid = new Map<string, Set<string>>(moving.map((body) => [body.id, new Set<string>()]));
  const apart = (a: string, b: string): void => {
    avoid.get(a)?.add(b);
    avoid.get(b)?.add(a);
  };

  for (const joint of compiled.joints) {
    const ids = [...new Set(joint.points.map((ref) => ref.split(".")[0] as string))];
    for (const a of ids)
      for (const b of ids) if (a !== b && a !== GROUND && b !== GROUND) apart(a, b);
  }

  const stride = Math.max(1, Math.floor(cycle.count / INSTANTS));
  for (let k = 0; k < cycle.count; k += stride) {
    const hulls = moving.map((body) => {
      const at = k * cycle.width + 3 * body.index;
      const c = Math.cos(cycle.q[at + 2]);
      const s = Math.sin(cycle.q[at + 2]);
      return convexHull(
        [...body.points.values()].map(
          ({ u, v }): Point => [cycle.q[at] + u * c - v * s, cycle.q[at + 1] + u * s + v * c],
        ),
      );
    });
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) {
        const a = moving[i] as (typeof moving)[number];
        const b = moving[j] as (typeof moving)[number];
        if (avoid.get(a.id)?.has(b.id)) continue;
        if (hullDistance(hulls[i] as Point[], hulls[j] as Point[]) < 2 * half) apart(a.id, b.id);
      }
    }
  }

  const placed = new Map<string, number>(
    moving.filter((body) => body.layerGiven).map((body) => [body.id, body.layer]),
  );
  for (const body of moving) {
    if (body.layerGiven) continue;
    const taken = new Set<number>();
    for (const other of avoid.get(body.id) ?? []) {
      const layer = placed.get(other);
      if (layer !== undefined) taken.add(layer);
    }
    let layer = 0;
    while (taken.has(layer)) layer++;
    body.layer = layer;
    placed.set(body.id, layer);
  }
}
