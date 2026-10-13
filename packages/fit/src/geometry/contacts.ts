import {
  alongArc,
  endOf,
  gap,
  insideShape,
  lengthOf,
  nearest,
  nearestOn,
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
  /** Less than nothing where the shapes are into each other there, by how deep. */
  distance: number;
  a: Point;
  b: Point;
  /** Unit direction the second shape goes to get clear of the first. */
  normal: Point;
}

/** Nearer than this, two places are one, in metres. */
const SAME = 1e-12;
/** Two directions closer than this angle are one, in radians. */
const PARALLEL = 1e-9;

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

/** Whether a place lies in the material of a shape, and not on its boundary. */
function sunk(shape: Shape, point: Point): boolean {
  return insideShape(shape, point[0], point[1]) && nearestOnShape(shape, point).d > SAME;
}

/** Whether a place on a segment is along it and not at one of its ends. */
function within(segment: Segment, point: Point): boolean {
  const along = parameter(segment, point);
  return along > 1e-9 && along < 1 - 1e-9;
}

function boundaryPlace(found: BoundarySegment, point: Point): number {
  return (
    found.before +
    Math.min(1, Math.max(0, parameter(found.segment, point))) * lengthOf(found.segment)
  );
}

/** The piece of a shape's boundary a place on it belongs to. */
function nearestSegment(boundary: Map<Segment, BoundarySegment>, point: Point): BoundarySegment {
  let best: BoundarySegment | undefined;
  let least = Number.POSITIVE_INFINITY;
  for (const found of boundary.values()) {
    const at = nearestOn(found.segment, point);
    const d = Math.hypot(at[0] - point[0], at[1] - point[1]);
    if (d < least) {
      least = d;
      best = found;
    }
  }
  return best as BoundarySegment;
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
  // A corner of one on a face of the other is held square to that face.
  const withinA = within(segmentA, pointA);
  const withinB = within(segmentB, pointB);
  if (withinA && !withinB) return outA;
  if (withinB && !withinA) return [-outB[0], -outB[1]];
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

/**
 * Two flat faces that lie along each other, facing: the two ends of the stretch they
 * share, each with the distance between the faces, which is less than nothing once
 * they have passed each other. Their nearest places alone would be one arbitrary
 * place along the stretch, and no direction at all where the faces touch.
 */
function facingLines(segmentA: Segment, segmentB: Segment): ContactPoint[] | undefined {
  if (segmentA.kind !== "line" || segmentB.kind !== "line") return undefined;
  const lengthA = lengthOf(segmentA);
  const lengthB = lengthOf(segmentB);
  if (lengthA <= SAME || lengthB <= SAME) return undefined;
  const ux = (segmentA.bx - segmentA.ax) / lengthA;
  const uy = (segmentA.by - segmentA.ay) / lengthA;
  const vx = (segmentB.bx - segmentB.ax) / lengthB;
  const vy = (segmentB.by - segmentB.ay) / lengthB;
  // Along each other, and going opposite ways round: the material of each is on its own side.
  if (Math.abs(ux * vy - uy * vx) > PARALLEL || ux * vx + uy * vy > 0) return undefined;
  const from = (segmentB.bx - segmentA.ax) * ux + (segmentB.by - segmentA.ay) * uy;
  const to = (segmentB.ax - segmentA.ax) * ux + (segmentB.ay - segmentA.ay) * uy;
  const low = Math.max(0, from);
  const high = Math.min(lengthA, to);
  if (high - low <= SAME) return undefined;
  const normal: Point = [uy, -ux];
  const distance =
    (segmentB.ax - segmentA.ax) * normal[0] + (segmentB.ay - segmentA.ay) * normal[1];
  return [low, high].map((along) => {
    const a: Point = [segmentA.ax + along * ux, segmentA.ay + along * uy];
    return { distance, a, b: [a[0] + distance * normal[0], a[1] + distance * normal[1]], normal };
  });
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
 * along both outlines. Where the shapes are into each other the distance is less
 * than nothing, and the normal still says which way the second gets clear.
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

  const push = (
    segmentA: Segment,
    segmentB: Segment,
    found: ContactPoint,
    alignment: number,
  ): void => {
    const onA = boundaryA.get(segmentA) as BoundarySegment;
    const onB = boundaryB.get(segmentB) as BoundarySegment;
    candidates.push({
      ...found,
      alignment,
      loopA: onA.loop,
      loopB: onB.loop,
      alongA: boundaryPlace(onA, found.a),
      alongB: boundaryPlace(onB, found.b),
      loopLengthA: onA.loopLength,
      loopLengthB: onB.loopLength,
    });
  };

  const take = (segmentA: Segment, segmentB: Segment): void => {
    const faces = facingLines(segmentA, segmentB);
    if (faces) {
      for (const found of faces) {
        if (Math.abs(found.distance) <= margin) push(segmentA, segmentB, found, 1);
      }
      return;
    }
    const pair = nearest(segmentA, segmentB);
    if (pair.d > margin) return;
    // Two edges in one line that meet end to end hold nothing: the faces beside them do.
    if (pair.d <= SAME && alignmentOf(segmentA, pair.pa, segmentB, pair.pb) < -0.5) return;
    const normal = normalOf(segmentA, pair.pa, segmentB, pair.pb, a, b);
    // Two boundaries have passed each other where the nearest place of one lies in
    // the material of the other; they are that far in.
    const passed = pair.d > SAME && (sunk(b, pair.pa) || sunk(a, pair.pb));
    push(
      segmentA,
      segmentB,
      {
        distance: passed ? -pair.d : pair.d,
        a: pair.pa,
        b: pair.pb,
        normal: passed ? [-normal[0], -normal[1]] : normal,
      },
      alignmentOf(segmentA, pair.pa, segmentB, pair.pb),
    );
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

  // Where a corner or a bulge of one is inside the other, the crossings of their
  // boundaries say nothing of how deep: the deepest place does, and stands for them.
  const over = gap(shapeA, poseA, shapeB, poseB, margin);
  if (over && over.distance < -SAME) {
    const depth = -over.distance;
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (Math.abs((candidates[i] as Candidate).distance) <= SAME) candidates.splice(i, 1);
    }
    const onA = nearestSegment(boundaryA, over.a);
    const onB = nearestSegment(boundaryB, over.b);
    candidates.push({
      distance: -depth,
      a: over.a,
      b: over.b,
      normal: unit([over.a[0] - over.b[0], over.a[1] - over.b[1]]),
      alignment: 1,
      loopA: onA.loop,
      loopB: onB.loop,
      alongA: boundaryPlace(onA, over.a),
      alongB: boundaryPlace(onB, over.b),
      loopLengthA: onA.loopLength,
      loopLengthB: onB.loopLength,
    });
  }

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
