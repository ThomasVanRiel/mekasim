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
export const MAX_CONTACT_POINTS = 6;

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
/** Two places this near are taken to be on each other where a corner meets a corner, in metres. */
const HAIR = 1e-9;
/** Two unit directions whose product is above this hold the same way: within about 2.5 degrees. */
const SAME_WAY = 0.999;
/** Two directions closer than this angle are one, in radians. */
const PARALLEL = 1e-9;

interface BoundarySegment {
  segment: Segment;
  /** The pieces of the same loop that come before and after it. */
  previous: Segment;
  next: Segment;
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
      const count = loop.segments.length;
      found.set(segment, {
        segment,
        previous: loop.segments[(i + count - 1) % count] as Segment,
        next: loop.segments[(i + 1) % count] as Segment,
        loop: loopIndex,
        before,
        loopLength,
      });
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

/** The end of a segment that a place on it is within a hair of, if it is. */
function endNear(segment: Segment, point: Point): Point | undefined {
  for (const end of [startOf(segment), endOf(segment)]) {
    if (Math.hypot(end[0] - point[0], end[1] - point[1]) <= HAIR) return end;
  }
  return undefined;
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

/** The way along a segment at one of its ends, in the direction the loop goes round. */
function heading(segment: Segment, atStart: boolean): Point {
  if (segment.kind === "line") return unit([segment.bx - segment.ax, segment.by - segment.ay]);
  const angle = segment.start + (atStart ? 0 : segment.sweep);
  const way = segment.sweep >= 0 ? 1 : -1;
  return [-way * Math.sin(angle), way * Math.cos(angle)];
}

/**
 * The two edges that meet at a corner: for each, the way it leaves the corner and
 * the way out of the material beside it.
 */
function edgesAt(found: BoundarySegment, point: Point): { leaving: Point; out: Point }[] {
  const { segment } = found;
  const atStart = parameter(segment, point) < 0.5;
  const other = atStart ? found.previous : found.next;
  const forward = heading(segment, atStart);
  const beside = heading(other, !atStart);
  return [
    { leaving: atStart ? forward : [-forward[0], -forward[1]], out: outward(segment, point) },
    { leaving: atStart ? [-beside[0], -beside[1]] : beside, out: outward(other, point) },
  ];
}

/**
 * Two corners on one place: the face of either that has the other part wholly on
 * its outside, and by most. Without one, the corners are into each other.
 */
function cornerNormal(onA: BoundarySegment, pointA: Point, onB: BoundarySegment, pointB: Point) {
  const edgesA = edgesAt(onA, pointA);
  const edgesB = edgesAt(onB, pointB);
  let best: Point | undefined;
  let clear = -1e-9;
  for (const normal of [
    ...edgesA.map(({ out }): Point => out),
    ...edgesB.map(({ out }): Point => [-out[0], -out[1]]),
  ]) {
    // Along it, B's edges must leave forwards and A's backwards.
    const forwards = Math.min(
      ...edgesB.map(({ leaving: [x, y] }) => x * normal[0] + y * normal[1]),
    );
    const backwards = Math.max(
      ...edgesA.map(({ leaving: [x, y] }) => x * normal[0] + y * normal[1]),
    );
    const room = Math.min(forwards, -backwards);
    if (room > clear) {
      clear = room;
      best = normal;
    }
  }
  return best;
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

/**
 * Whether two candidates are one contact: on one place of both boundaries, and
 * holding the same way. Two that hold different ways on one place are both needed,
 * as where a corner of each lies against a face of the other.
 */
function samePlace(a: Candidate, b: Candidate, merge: number): boolean {
  return (
    a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] > SAME_WAY &&
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
 * The distinct nearby places on two shapes, the nearest six at most, for the contact
 * step to hold apart. Where the shapes are into each other the distance is less
 * than nothing, and the normal still says which way the second gets clear.
 *
 * They are gathered three ways, so that each holds only where it is true:
 * every corner of one against the nearest place of the other, which is a face
 * while the corner is beside it and the face's own corner once it has passed its
 * end; two flat faces that lie along each other, at the two ends of the stretch
 * they share; and two boundaries of which one at least is curved, where they are
 * nearest along both.
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
    onA: BoundarySegment,
    onB: BoundarySegment,
    found: ContactPoint,
    alignment: number,
  ): void => {
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

  /** Every corner of one shape against the nearest place of the other. */
  const corners = (ofA: boolean): void => {
    const own = ofA ? boundaryA : boundaryB;
    const other = ofA ? b : a;
    const otherBoundary = ofA ? boundaryB : boundaryA;
    const { minX, maxX, minY, maxY } = other.bounds;
    for (const onOwn of own.values()) {
      const corner = startOf(onOwn.segment);
      const [x, y] = corner;
      if (x < minX - margin || x > maxX + margin || y < minY - margin || y > maxY + margin)
        continue;
      const { d, at } = nearestOnShape(other, corner);
      if (d > margin) continue;
      const onOther = nearestSegment(otherBoundary, at);
      const onA = ofA ? onOwn : onOther;
      const onB = ofA ? onOther : onOwn;
      const pointA = ofA ? corner : at;
      const pointB = ofA ? at : corner;
      // A corner that is a hair from a corner of the other shape is on it: the face
      // it has all but left would hold it as if the face went on.
      const end = endNear(onOther.segment, at);
      const meeting = d <= HAIR && end !== undefined;
      const inside = d > SAME && !meeting && insideShape(other, x, y);
      let normal: Point;
      if (meeting) {
        const square = ofA
          ? cornerNormal(onOwn, corner, onOther, end)
          : cornerNormal(onOther, end, onOwn, corner);
        // Without a face that keeps them apart the corners are into each other, which other places measure.
        if (!square) continue;
        normal = square;
      } else if (d > SAME) {
        // Apart, the second gets clear along the line from the first's place to its own;
        // with the corner inside the other shape that line runs the other way.
        const along = unit([pointB[0] - pointA[0], pointB[1] - pointA[1]]);
        normal = inside ? [-along[0], -along[1]] : along;
      } else {
        // A corner on a face is held square to the face, if it lies against it from
        // outside. One whose edges go on into the face is of parts into each other.
        const out = outward(onOther.segment, at);
        const into = edgesAt(onOwn, corner).some(
          ({ leaving }) => leaving[0] * out[0] + leaving[1] * out[1] < -1e-9,
        );
        if (into) continue;
        normal = ofA ? [-out[0], -out[1]] : out;
      }
      push(onA, onB, { distance: inside ? -d : d, a: pointA, b: pointB, normal }, 0.5);
    }
  };
  corners(true);
  corners(false);

  const take = (segmentA: Segment, segmentB: Segment): void => {
    const onA = boundaryA.get(segmentA) as BoundarySegment;
    const onB = boundaryB.get(segmentB) as BoundarySegment;
    const faces = facingLines(segmentA, segmentB);
    if (faces) {
      for (const found of faces) {
        if (Math.abs(found.distance) <= margin) push(onA, onB, found, 1);
      }
      return;
    }
    // Two straight edges are nearest at a corner of one, which the corners have taken.
    if (segmentA.kind === "line" && segmentB.kind === "line") return;
    const pair = nearest(segmentA, segmentB);
    // So have they where a curve is nearest at one of its ends; and where a curve
    // crosses the other boundary, the deepest place of the overlap stands for it.
    if (pair.d > margin || pair.d <= SAME) return;
    if (!within(segmentA, pair.pa) || !within(segmentB, pair.pb)) return;
    const along = unit([pair.pb[0] - pair.pa[0], pair.pb[1] - pair.pa[1]]);
    const passed = sunk(b, pair.pa) || sunk(a, pair.pb);
    push(
      onA,
      onB,
      {
        distance: passed ? -pair.d : pair.d,
        a: pair.pa,
        b: pair.pb,
        normal: passed ? [-along[0], -along[1]] : along,
      },
      0,
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

  // Where a curve of one bulges into the other, no corner is inside and nothing
  // above measures how deep: the deepest place of the overlap does.
  const over = gap(shapeA, poseA, shapeB, poseB, margin);
  if (over && over.distance < -SAME) {
    const onA = nearestSegment(boundaryA, over.a);
    const onB = nearestSegment(boundaryB, over.b);
    const outA = outward(onA.segment, over.a);
    const outB = outward(onB.segment, over.b);
    // The way out is square to the face the deepest place is under.
    const normal: Point = within(onA.segment, over.a)
      ? outA
      : within(onB.segment, over.b)
        ? [-outB[0], -outB[1]]
        : (cornerNormal(onA, over.a, onB, over.b) ??
          unit([over.a[0] - over.b[0], over.a[1] - over.b[1]]));
    push(onA, onB, { distance: over.distance, a: over.a, b: over.b, normal }, 0.25);
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
