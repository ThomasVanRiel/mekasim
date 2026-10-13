import type { Point } from "./outline.ts";

/**
 * Outlines of parts, made of straight lines and true arcs. Lengths are in whatever
 * unit the caller works in; a compiled shape is in metres, in its body's frame.
 */

/** A straight line from a to b, or an arc of a circle. */
export type Segment =
  | { kind: "line"; ax: number; ay: number; bx: number; by: number }
  /**
   * From the angle `start` round the centre by `sweep`: anticlockwise when it is
   * positive, clockwise when negative. A whole circle has a sweep of a full turn.
   */
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; sweep: number };

/** A closed outline: each segment starts where the one before it ends. */
export interface Loop {
  segments: Segment[];
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A part's outline with the holes cut out of it. */
export interface Shape {
  /** The outside, anticlockwise. */
  outer: Loop;
  /** The holes, clockwise. */
  holes: Loop[];
  bounds: Box;
  /** The furthest the shape reaches from the origin of its frame. */
  radius: number;
}

export type { Point };

const TURN = 2 * Math.PI;

export function startOf(segment: Segment): Point {
  if (segment.kind === "line") return [segment.ax, segment.ay];
  return pointAt(segment, segment.start);
}

export function endOf(segment: Segment): Point {
  if (segment.kind === "line") return [segment.bx, segment.by];
  return pointAt(segment, segment.start + segment.sweep);
}

/** The point of an arc's circle at an angle. */
export function pointAt(arc: Segment & { kind: "arc" }, angle: number): Point {
  return [arc.cx + arc.r * Math.cos(angle), arc.cy + arc.r * Math.sin(angle)];
}

/** How far round an arc an angle lies, from 0 at its start to 1 at its end; outside that, off the arc. */
export function alongArc(arc: Segment & { kind: "arc" }, angle: number): number {
  const sign = arc.sweep >= 0 ? 1 : -1;
  let turned = (sign * (angle - arc.start)) % TURN;
  if (turned < 0) turned += TURN;
  const span = Math.abs(arc.sweep);
  // An angle a hair before the start is the start, not a whole turn on.
  if (turned > span && TURN - turned < 1e-12) turned = 0;
  return span === 0 ? Number.POSITIVE_INFINITY : turned / span;
}

export function lengthOf(segment: Segment): number {
  if (segment.kind === "line") return Math.hypot(segment.bx - segment.ax, segment.by - segment.ay);
  return Math.abs(segment.sweep) * segment.r;
}

function reversed(segment: Segment): Segment {
  if (segment.kind === "line") {
    return { kind: "line", ax: segment.bx, ay: segment.by, bx: segment.ax, by: segment.ay };
  }
  return { ...segment, start: segment.start + segment.sweep, sweep: -segment.sweep };
}

/** The same outline gone round the other way. */
export function reverseLoop(loop: Loop): Loop {
  return { segments: loop.segments.map(reversed).reverse() };
}

/** The area inside a loop: positive when it goes anticlockwise, negative when clockwise. */
export function loopArea(loop: Loop): number {
  let twice = 0;
  for (const segment of loop.segments) {
    if (segment.kind === "line") {
      twice += segment.ax * segment.by - segment.bx * segment.ay;
    } else {
      const [x0, y0] = startOf(segment);
      const [x1, y1] = endOf(segment);
      twice +=
        segment.r * segment.r * segment.sweep + segment.cx * (y1 - y0) - segment.cy * (x1 - x0);
    }
  }
  return twice / 2;
}

function grow(box: Box, x: number, y: number): void {
  box.minX = Math.min(box.minX, x);
  box.maxX = Math.max(box.maxX, x);
  box.minY = Math.min(box.minY, y);
  box.maxY = Math.max(box.maxY, y);
}

export function segmentBounds(segment: Segment, box: Box = emptyBox()): Box {
  grow(box, ...startOf(segment));
  grow(box, ...endOf(segment));
  if (segment.kind === "arc") {
    // An arc reaches furthest where it passes straight right, up, left or down of its centre.
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = (quarter * Math.PI) / 2;
      if (alongArc(segment, angle) <= 1) grow(box, ...pointAt(segment, angle));
    }
  }
  return box;
}

export function emptyBox(): Box {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

export function loopBounds(loop: Loop, box: Box = emptyBox()): Box {
  for (const segment of loop.segments) segmentBounds(segment, box);
  return box;
}

/** The furthest a loop reaches from the origin. */
export function reach(loop: Loop): number {
  let far = 0;
  for (const segment of loop.segments) {
    far = Math.max(far, Math.hypot(...startOf(segment)), Math.hypot(...endOf(segment)));
    if (segment.kind === "arc") {
      // The far side of the circle counts when the arc passes through it.
      const away = Math.atan2(segment.cy, segment.cx);
      const centre = Math.hypot(segment.cx, segment.cy);
      if (centre < 1e-300 || alongArc(segment, away) <= 1) far = Math.max(far, centre + segment.r);
    }
  }
  return far;
}

/** How a loop is laid down somewhere else: scaled, mirrored in the y axis, turned, then moved. */
export interface Placement {
  x?: number;
  y?: number;
  angle?: number;
  scale?: number;
  mirror?: boolean;
}

/** A place laid down somewhere else. */
export function placePoint([px, py]: Point, placement: Placement): Point {
  const { x = 0, y = 0, angle = 0, scale = 1, mirror = false } = placement;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = (mirror ? -1 : 1) * px * scale;
  const sy = py * scale;
  return [x + sx * cos - sy * sin, y + sx * sin + sy * cos];
}

export function placeLoop(loop: Loop, placement: Placement): Loop {
  const { angle = 0, scale = 1, mirror = false } = placement;
  const flip = mirror ? -1 : 1;
  const point = (px: number, py: number): Point => placePoint([px, py], placement);
  return {
    segments: loop.segments.map((segment): Segment => {
      if (segment.kind === "line") {
        const [ax, ay] = point(segment.ax, segment.ay);
        const [bx, by] = point(segment.bx, segment.by);
        return { kind: "line", ax, ay, bx, by };
      }
      const [cx, cy] = point(segment.cx, segment.cy);
      // Mirrored in the y axis, an angle a becomes pi - a, and the arc goes round the other way.
      const start = (mirror ? Math.PI - segment.start : segment.start) + angle;
      return {
        kind: "arc",
        cx,
        cy,
        r: segment.r * Math.abs(scale),
        start,
        sweep: flip * segment.sweep,
      };
    }),
  };
}

/** A shape laid down somewhere else, with its bounds and reach found anew. */
export function placeShape(shape: Shape, placement: Placement): Shape {
  let outer = placeLoop(shape.outer, placement);
  let holes = shape.holes.map((hole) => placeLoop(hole, placement));
  // Mirrored, every loop goes round the other way; turn them back.
  if (placement.mirror) {
    outer = reverseLoop(outer);
    holes = holes.map(reverseLoop);
  }
  return { outer, holes, bounds: loopBounds(outer), radius: reach(outer) };
}

/**
 * How many times a loop goes round a point: 0 outside it, 1 inside an anticlockwise
 * loop, -1 inside a clockwise one. Exact for arcs as for lines; a point on the loop
 * itself may come out either way.
 */
export function windingOf(loop: Loop, x: number, y: number): number {
  let turned = 0;
  for (const segment of loop.segments) {
    const [x0, y0] = startOf(segment);
    const [x1, y1] = endOf(segment);
    const ux = x0 - x;
    const uy = y0 - y;
    const vx = x1 - x;
    const vy = y1 - y;
    // The direction from the point to the segment's end, less that to its start.
    let change = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (segment.kind === "arc") {
      const inside = Math.hypot(x - segment.cx, y - segment.cy) < segment.r;
      // Seen from inside its circle an arc turns the way it goes, by up to a whole turn;
      // seen from outside it never turns by half a turn.
      if (inside) {
        if (segment.sweep > 0 && change <= 0) change += TURN;
        else if (segment.sweep < 0 && change >= 0) change -= TURN;
      }
    }
    turned += change;
  }
  return Math.round(turned / TURN);
}

export function insideLoop(loop: Loop, x: number, y: number): boolean {
  return windingOf(loop, x, y) !== 0;
}

/** Whether a point is in the material of a shape: inside its outline and in none of its holes. */
export function insideShape(shape: Shape, x: number, y: number): boolean {
  return insideLoop(shape.outer, x, y) && !shape.holes.some((hole) => insideLoop(hole, x, y));
}

/**
 * A loop as a polygon, for what can only take straight sides: its arcs cut into
 * `perTurn` sides to a full circle. The first corner is not given again at the end.
 */
export function flattenLoop(loop: Loop, perTurn = 96): Point[] {
  const corners: Point[] = [];
  for (const segment of loop.segments) {
    if (segment.kind === "line") {
      corners.push([segment.ax, segment.ay]);
      continue;
    }
    const sides = Math.max(1, Math.ceil((Math.abs(segment.sweep) / TURN) * perTurn));
    for (let k = 0; k < sides; k++) {
      corners.push(pointAt(segment, segment.start + (segment.sweep * k) / sides));
    }
  }
  return corners;
}

/** A round hole as a loop: one arc all the way round, clockwise as holes go. */
export function circleLoop(cx: number, cy: number, r: number, clockwise = true): Loop {
  return { segments: [{ kind: "arc", cx, cy, r, start: 0, sweep: clockwise ? -TURN : TURN }] };
}
