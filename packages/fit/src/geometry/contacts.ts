import {
  alongArc,
  endOf,
  insideShape,
  lengthOf,
  nearest,
  nearestOnShape,
  type Point,
  type Pose,
  placeShape,
  type Segment,
  type Shape,
  startOf,
  type Tree,
  treeOf,
} from "@mekasim/core";

/** How near two boundaries must be before they can become a contact in the next step. */
export const CONTACT_MARGIN = 2e-3;
/** Nearby answers at the same place on both boundaries count as one contact. */
export const CONTACT_MERGE = 0.2e-3;
export const MAX_CONTACT_POINTS = 4;

export interface ContactPoint {
  distance: number;
  a: Point;
  b: Point;
  /** Unit direction from the first shape towards the second. */
  normal: Point;
}

interface BoundarySegment {
  segment: Segment;
  loop: number;
  before: number;
  loopLength: number;
}

interface Candidate extends ContactPoint {
  alignment: number;
  loopA: number;
  loopB: number;
  alongA: number;
  alongB: number;
}

function boundaries(shape: Shape): Map<Segment, BoundarySegment> {
  const found = new Map<Segment, BoundarySegment>();
  [shape.outer, ...shape.holes].forEach((loop, loopIndex) => {
    const lengths = loop.segments.map(lengthOf);
    const loopLength = lengths.reduce((sum, value) => sum + value, 0);
    let before = 0;
    loop.segments.forEach((segment, i) => {
      found.set(segment, { segment, loop: loopIndex, before, loopLength });
      before += lengths[i] as number;
    });
  });
  return found;
}

function parameter(segment: Segment, point: Point): number {
  if (segment.kind === "line") {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const length2 = dx * dx + dy * dy;
    return length2 === 0
      ? 0
      : ((point[0] - segment.ax) * dx + (point[1] - segment.ay) * dy) / length2;
  }
  return alongArc(segment, Math.atan2(point[1] - segment.cy, point[0] - segment.cx));
}

function boundaryPlace(found: BoundarySegment, point: Point): number {
  return (
    found.before +
    Math.min(1, Math.max(0, parameter(found.segment, point))) * lengthOf(found.segment)
  );
}

function unit([x, y]: Point, fallback: Point = [1, 0]): Point {
  const length = Math.hypot(x, y);
  return length > 1e-15 ? [x / length, y / length] : fallback;
}

/** Outward from the material at a boundary point; valid for outer and hole winding alike. */
function outward(segment: Segment, point: Point): Point {
  if (segment.kind === "line") return unit([segment.by - segment.ay, segment.ax - segment.bx]);
  const angle = Math.atan2(point[1] - segment.cy, point[0] - segment.cx);
  const direction = segment.sweep >= 0 ? 1 : -1;
  return unit([direction * Math.cos(angle), direction * Math.sin(angle)]);
}

function penetration(segment: Segment, shape: Shape): number {
  let depth = 0;
  for (const point of [startOf(segment), endOf(segment)]) {
    if (insideShape(shape, point[0], point[1]))
      depth = Math.max(depth, nearestOnShape(shape, point).d);
  }
  return depth;
}

function normalOf(
  segmentA: Segment,
  pointA: Point,
  segmentB: Segment,
  pointB: Point,
  shapeA: Shape,
  shapeB: Shape,
): Point {
  const dx = pointB[0] - pointA[0];
  const dy = pointB[1] - pointA[1];
  if (Math.hypot(dx, dy) > 1e-15) return unit([dx, dy]);

  const outA = outward(segmentA, pointA);
  const outB = outward(segmentB, pointB);
  const aInsideB = penetration(segmentA, shapeB);
  const bInsideA = penetration(segmentB, shapeA);
  if (aInsideB > bInsideA + 1e-12) return [-outB[0], -outB[1]];
  if (bInsideA > aInsideB + 1e-12) return outA;
  return unit([outA[0] - outB[0], outA[1] - outB[1]], outA);
}

function alignmentOf(segmentA: Segment, pointA: Point, segmentB: Segment, pointB: Point): number {
  const outA = outward(segmentA, pointA);
  const outB = outward(segmentB, pointB);
  return -(outA[0] * outB[0] + outA[1] * outB[1]);
}

function boxDistance(a: Tree["box"], b: Tree["box"]): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy);
}

function around(a: number, b: number, length: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, length - distance);
}

function samePlace(a: Candidate, b: Candidate, merge: number): boolean {
  return (
    a.loopA === b.loopA &&
    a.loopB === b.loopB &&
    around(a.alongA, b.alongA, a.loopLengthA) <= merge &&
    around(a.alongB, b.alongB, a.loopLengthB) <= merge
  );
}

/** Internal lengths used only while merging candidates along their two boundaries. */
interface Candidate {
  loopLengthA: number;
  loopLengthB: number;
}

/**
 * Up to four distinct nearby places on two shapes. The exact segment distances are
 * pruned by boundary trees; duplicates at shared segment ends are merged by distance
 * along both outlines.
 */
export function contactPoints(
  shapeA: Shape,
  poseA: Pose,
  shapeB: Shape,
  poseB: Pose,
  margin = CONTACT_MARGIN,
  merge = CONTACT_MERGE,
): ContactPoint[] {
  if (margin < 0 || merge < 0) throw new Error("Contact distances cannot be negative");
  const a = placeShape(shapeA, poseA);
  const b = placeShape(shapeB, poseB);
  const boundaryA = boundaries(a);
  const boundaryB = boundaries(b);
  const candidates: Candidate[] = [];

  const take = (segmentA: Segment, segmentB: Segment): void => {
    const pair = nearest(segmentA, segmentB);
    if (pair.d > margin) return;
    const onA = boundaryA.get(segmentA) as BoundarySegment;
    const onB = boundaryB.get(segmentB) as BoundarySegment;
    candidates.push({
      distance: pair.d,
      a: pair.pa,
      b: pair.pb,
      normal: normalOf(segmentA, pair.pa, segmentB, pair.pb, a, b),
      alignment: alignmentOf(segmentA, pair.pa, segmentB, pair.pb),
      loopA: onA.loop,
      loopB: onB.loop,
      alongA: boundaryPlace(onA, pair.pa),
      alongB: boundaryPlace(onB, pair.pb),
      loopLengthA: onA.loopLength,
      loopLengthB: onB.loopLength,
    });
  };

  const visit = (treeA: Tree, treeB: Tree): void => {
    if (boxDistance(treeA.box, treeB.box) > margin) return;
    if (treeA.segments && treeB.segments) {
      for (const segmentA of treeA.segments)
        for (const segmentB of treeB.segments) take(segmentA, segmentB);
      return;
    }
    if (!treeA.segments && (treeB.segments || treeA.r >= treeB.r)) {
      visit(treeA.left as Tree, treeB);
      visit(treeA.right as Tree, treeB);
    } else {
      visit(treeA, treeB.left as Tree);
      visit(treeA, treeB.right as Tree);
    }
  };
  visit(treeOf(a), treeOf(b));

  candidates.sort(
    (left, right) => left.distance - right.distance || right.alignment - left.alignment,
  );
  const distinct: Candidate[] = [];
  for (const candidate of candidates) {
    if (!distinct.some((kept) => samePlace(candidate, kept, merge))) distinct.push(candidate);
  }
  return distinct
    .slice(0, MAX_CONTACT_POINTS)
    .map(({ distance, a: atA, b: atB, normal }) => ({ distance, a: atA, b: atB, normal }));
}
