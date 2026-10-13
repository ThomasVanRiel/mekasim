import {
  alongArc,
  endOf,
  insideShape,
  intersections,
  type Point,
  pointAt,
  type Segment,
  type Shape,
  startOf,
} from "@mekasim/core";
import { boxDistance, type Tree, treeOf } from "./tree.ts";

type Line = Segment & { kind: "line" };
type Arc = Segment & { kind: "arc" };

/** Two places, one on each of two things, and how far apart they are. */
export interface Nearest {
  d: number;
  pa: Point;
  pb: Point;
}

/** Where a body's frame is: its origin, and how far it is turned. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

const apart = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The place on a segment nearest to a point. */
export function nearestOn(segment: Segment, [x, y]: Point): Point {
  if (segment.kind === "line") {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - segment.ax) * dx + (y - segment.ay) * dy) / length2));
    return [segment.ax + t * dx, segment.ay + t * dy];
  }
  const angle = Math.atan2(y - segment.cy, x - segment.cx);
  if (alongArc(segment, angle) <= 1) return pointAt(segment, angle);
  const from = startOf(segment);
  const to = endOf(segment);
  return apart(from, [x, y]) <= apart(to, [x, y]) ? from : to;
}

/** The places on an arc where it goes straight across a direction, on either side of its centre. */
function across(arc: Arc, dx: number, dy: number): Point[] {
  const angle = Math.atan2(dy, dx);
  return [angle, angle + Math.PI]
    .filter((at) => alongArc(arc, at) <= 1)
    .map((at) => pointAt(arc, at));
}

/**
 * The places of each of two segments, away from their ends, where the shortest way
 * to the other may start: for an arc, where it faces the other or turns its back on
 * it; for a line, below the middle of an arc.
 */
function facing(a: Segment, b: Segment): { onA: Point[]; onB: Point[] } {
  if (a.kind === "line" && b.kind === "line") return { onA: [], onB: [] };
  if (a.kind === "arc" && b.kind === "arc") {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    if (dx === 0 && dy === 0) return { onA: [], onB: [] };
    return { onA: across(a, dx, dy), onB: across(b, dx, dy) };
  }
  const line = (a.kind === "line" ? a : b) as Line;
  const arc = (a.kind === "arc" ? a : b) as Arc;
  const onArc = across(arc, line.by - line.ay, line.ax - line.bx);
  const foot = nearestOn(line, [arc.cx, arc.cy]);
  return a.kind === "line" ? { onA: [foot], onB: onArc } : { onA: onArc, onB: [foot] };
}

/**
 * The two places, one on each of two segments, that are nearest to each other.
 * Where the segments cross or touch, the distance is nothing and both places are
 * where they do.
 */
export function nearest(a: Segment, b: Segment): Nearest {
  const [crossing] = intersections(a, b, 0);
  if (crossing) return { d: 0, pa: crossing, pb: crossing };
  let best: Nearest = { d: Number.POSITIVE_INFINITY, pa: startOf(a), pb: startOf(b) };
  const take = (pa: Point, pb: Point): void => {
    const d = apart(pa, pb);
    if (d < best.d) best = { d, pa, pb };
  };
  const { onA, onB } = facing(a, b);
  for (const pa of [startOf(a), endOf(a), ...onA]) take(pa, nearestOn(b, pa));
  for (const pb of [startOf(b), endOf(b), ...onB]) take(nearestOn(a, pb), pb);
  return best;
}

/** The place on the edge of a shape nearest to a point, in the shape's own frame. */
export function nearestOnShape(shape: Shape, point: Point): { d: number; at: Point } {
  let best = { d: Number.POSITIVE_INFINITY, at: point };
  const visit = (tree: Tree): void => {
    if (boxDistance(tree.box, point[0], point[1]) >= best.d) return;
    if (tree.segments) {
      for (const segment of tree.segments) {
        const at = nearestOn(segment, point);
        const d = apart(at, point);
        if (d < best.d) best = { d, at };
      }
      return;
    }
    const left = tree.left as Tree;
    const right = tree.right as Tree;
    const first =
      boxDistance(left.box, point[0], point[1]) <= boxDistance(right.box, point[0], point[1]);
    visit(first ? left : right);
    visit(first ? right : left);
  };
  visit(treeOf(shape));
  return best;
}

/** The smallest distance between two shapes, and where it is measured. */
export interface Gap {
  /** Less than nothing where the shapes overlap, by how deep. */
  distance: number;
  /** The place on the first shape and the place on the second, on the sheet. */
  a: Point;
  b: Point;
}

/**
 * The smallest distance between two shapes, each where its body is, with the two
 * places it is between. Where the shapes overlap the distance is less than nothing:
 * how far the deepest corner or bulge of one is inside the other, which is exact for
 * the small overlaps that matter and an estimate for large ones.
 *
 * `within` leaves out what is further apart than that: nothing is given back then.
 */
export function gap(
  a: Shape,
  poseA: Pose,
  b: Shape,
  poseB: Pose,
  within = Number.POSITIVE_INFINITY,
): Gap | undefined {
  // Everything is measured in the first shape's frame, the second brought into it.
  const turn = poseB.angle - poseA.angle;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const cosA = Math.cos(poseA.angle);
  const sinA = Math.sin(poseA.angle);
  const ox = (poseB.x - poseA.x) * cosA + (poseB.y - poseA.y) * sinA;
  const oy = -(poseB.x - poseA.x) * sinA + (poseB.y - poseA.y) * cosA;
  const intoA = ([x, y]: Point): Point => [ox + x * cos - y * sin, oy + x * sin + y * cos];
  const intoB = ([x, y]: Point): Point => [
    (x - ox) * cos + (y - oy) * sin,
    -(x - ox) * sin + (y - oy) * cos,
  ];
  const onSheet = ([x, y]: Point): Point => [
    poseA.x + x * cosA - y * sinA,
    poseA.y + x * sinA + y * cosA,
  ];

  // Quickly, by how far each shape reaches from its frame.
  if (Math.hypot(ox, oy) - a.radius - b.radius > within) return undefined;

  const moved = new Map<Segment, Segment>();
  const inA = (segment: Segment): Segment => {
    let found = moved.get(segment);
    if (!found) {
      if (segment.kind === "line") {
        const [ax, ay] = intoA([segment.ax, segment.ay]);
        const [bx, by] = intoA([segment.bx, segment.by]);
        found = { kind: "line", ax, ay, bx, by };
      } else {
        const [cx, cy] = intoA([segment.cx, segment.cy]);
        found = { ...segment, cx, cy, start: segment.start + turn };
      }
      moved.set(segment, found);
    }
    return found;
  };

  /** No nearer than this can anything in two boxes be: the second box is taken as a circle. */
  const least = (ta: Tree, tb: Tree): number => {
    const [x, y] = intoA([tb.cx, tb.cy]);
    return Math.max(0, boxDistance(ta.box, x, y) - tb.r);
  };

  let best: Nearest = { d: within, pa: [0, 0], pb: [0, 0] };
  let found = false;
  /** The pairs of segments whose boxes run into each other, for when the shapes overlap. */
  const close: [Segment, Segment][] = [];
  const visit = (ta: Tree, tb: Tree): void => {
    const bound = least(ta, tb);
    if (bound > best.d || (found && bound >= best.d && bound > 0)) return;
    if (ta.segments && tb.segments) {
      for (const sa of ta.segments) {
        for (const sb of tb.segments) {
          const placed = inA(sb);
          if (bound === 0) close.push([sa, placed]);
          const pair = nearest(sa, placed);
          if (pair.d < best.d || (!found && pair.d <= best.d)) {
            best = pair;
            found = true;
          }
        }
      }
      return;
    }
    // The larger box is opened, and of its halves the nearer one is looked into first.
    if (!ta.segments && (tb.segments || ta.r >= tb.r)) {
      const left = ta.left as Tree;
      const right = ta.right as Tree;
      const first = least(left, tb) <= least(right, tb);
      visit(first ? left : right, tb);
      visit(first ? right : left, tb);
    } else {
      const left = tb.left as Tree;
      const right = tb.right as Tree;
      const first = least(ta, left) <= least(ta, right);
      visit(ta, first ? left : right);
      visit(ta, first ? right : left);
    }
  };
  visit(treeOf(a), treeOf(b));

  // Apart, unless one lies wholly in the material of the other, where no edges meet.
  const cornerA = startOf(a.outer.segments[0] as Segment);
  const cornerB = startOf(b.outer.segments[0] as Segment);
  const within2 = (shape: Shape, [x, y]: Point): boolean =>
    x >= shape.bounds.minX &&
    x <= shape.bounds.maxX &&
    y >= shape.bounds.minY &&
    y <= shape.bounds.maxY &&
    insideShape(shape, x, y);
  const swallowed = within2(b, intoB(cornerA)) || within2(a, intoA(cornerB));
  if (!swallowed && (!found || best.d > 0)) {
    return found ? { distance: best.d, a: onSheet(best.pa), b: onSheet(best.pb) } : undefined;
  }

  // Overlapping. The deepest of the corners of each inside the other, and of the
  // places where an arc of one bulges furthest into the other.
  let deepest: Nearest = { d: 0, pa: best.pa, pb: best.pb };
  const sink = (point: Point, ofA: boolean): void => {
    if (ofA) {
      const there = intoB(point);
      if (!within2(b, there)) return;
      const edge = nearestOnShape(b, there);
      if (edge.d > deepest.d) deepest = { d: edge.d, pa: point, pb: intoA(edge.at) };
    } else {
      if (!within2(a, point)) return;
      const edge = nearestOnShape(a, point);
      if (edge.d > deepest.d) deepest = { d: edge.d, pa: edge.at, pb: point };
    }
  };
  for (const loop of [a.outer, ...a.holes]) {
    for (const segment of loop.segments) sink(startOf(segment), true);
  }
  for (const loop of [b.outer, ...b.holes]) {
    for (const segment of loop.segments) sink(intoA(startOf(segment)), false);
  }
  for (const [sa, sb] of close) {
    const { onA, onB } = facing(sa, sb);
    for (const point of onA) sink(point, true);
    for (const point of onB) sink(point, false);
  }
  return { distance: -deepest.d, a: onSheet(deepest.pa), b: onSheet(deepest.pb) };
}
