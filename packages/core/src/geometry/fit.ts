import { alongArc, type Point, pointAt, type Segment } from "./shape.ts";

/**
 * A curve that is neither a line nor an arc, such as a spline or part of an
 * ellipse, given by where it is and which way it goes at each value of a parameter.
 */
export interface Curve {
  at(t: number): Point;
  /**
   * The direction it goes in at a parameter, of any length. At a corner there are
   * two: `before` asks for the one it arrives with.
   */
  along(t: number, before: boolean): Point;
  /**
   * The parameter at its start and at its end, and between them, in order, every
   * parameter where it may turn a corner.
   */
  breaks: number[];
}

const TURN = 2 * Math.PI;
/** How many places along a piece are measured against the arcs that are to replace it. */
const SAMPLES = 16;
/** How often a piece is halved before what is left is taken as straight. */
const DEEPEST = 40;

const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];

/**
 * The line or arc that leaves a place in a direction and reaches another. Nothing
 * when the two are one place.
 */
function leaving(from: Point, direction: Point, to: Point, tolerance: number): Segment | undefined {
  const chord: Point = [to[0] - from[0], to[1] - from[1]];
  const length2 = dot(chord, chord);
  if (length2 === 0) return undefined;
  const turn = cross(direction, chord);
  // An arc that rises a thousandth of the tolerance above its chord is a line.
  if (Math.abs(turn) / 4 <= tolerance * 1e-3) {
    return { kind: "line", ax: from[0], ay: from[1], bx: to[0], by: to[1] };
  }
  // The centre is to the left of the direction when it turns anticlockwise.
  const r = length2 / (2 * turn);
  const cx = from[0] - r * direction[1];
  const cy = from[1] + r * direction[0];
  const start = Math.atan2(from[1] - cy, from[0] - cx);
  let sweep = (Math.atan2(to[1] - cy, to[0] - cx) - start) % TURN;
  if (r > 0 && sweep <= 0) sweep += TURN;
  if (r < 0 && sweep >= 0) sweep -= TURN;
  return { kind: "arc", cx, cy, r: Math.abs(r), start, sweep };
}

/** The direction a segment arrives at its end with. */
function arriving(segment: Segment): Point {
  if (segment.kind === "line") {
    const length = Math.hypot(segment.bx - segment.ax, segment.by - segment.ay);
    return [(segment.bx - segment.ax) / length, (segment.by - segment.ay) / length];
  }
  const end = segment.start + segment.sweep;
  const way = segment.sweep > 0 ? 1 : -1;
  return [-way * Math.sin(end), way * Math.cos(end)];
}

function distanceTo(segment: Segment, [x, y]: Point): number {
  if (segment.kind === "line") {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const along = Math.min(
      1,
      Math.max(0, ((x - segment.ax) * dx + (y - segment.ay) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(x - segment.ax - along * dx, y - segment.ay - along * dy);
  }
  if (alongArc(segment, Math.atan2(y - segment.cy, x - segment.cx)) <= 1) {
    return Math.abs(Math.hypot(x - segment.cx, y - segment.cy) - segment.r);
  }
  const [sx, sy] = pointAt(segment, segment.start);
  const [ex, ey] = pointAt(segment, segment.start + segment.sweep);
  return Math.min(Math.hypot(x - sx, y - sy), Math.hypot(x - ex, y - ey));
}

/**
 * Two arcs that leave one place in one direction and arrive at another in another,
 * meeting each other without a corner. Nothing when the directions are too far
 * apart for that to come out well.
 */
function biarc(
  from: Point,
  leave: Point,
  to: Point,
  arrive: Point,
  tolerance: number,
): Segment[] | undefined {
  if (dot(leave, arrive) < -0.5) return undefined;
  const chord: Point = [to[0] - from[0], to[1] - from[1]];
  const both: Point = [leave[0] + arrive[0], leave[1] + arrive[1]];
  const forward = dot(chord, both);
  // How far along each direction the arcs' tangents meet, taken the same at both ends.
  const reach =
    dot(chord, chord) /
    (forward + Math.sqrt(forward * forward + 2 * (1 - dot(leave, arrive)) * dot(chord, chord)));
  if (!(reach > 0) || !Number.isFinite(reach)) return undefined;
  const a: Point = [from[0] + reach * leave[0], from[1] + reach * leave[1]];
  const b: Point = [to[0] - reach * arrive[0], to[1] - reach * arrive[1]];
  const joint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = leaving(from, leave, joint, tolerance);
  const second = leaving(
    joint,
    [(b[0] - a[0]) / (2 * reach), (b[1] - a[1]) / (2 * reach)],
    to,
    tolerance,
  );
  if (!first || !second) return undefined;
  for (const segment of [first, second]) {
    if (segment.kind === "arc" && Math.abs(segment.sweep) > Math.PI) return undefined;
  }
  return [first, second];
}

/**
 * Replace a curve by lines and arcs that stay within `tolerance` of it and meet
 * each other without corners, other than at the curve's own. Each smooth piece is
 * tried as one arc, then as two, and halved until that is near enough.
 */
export function fitArcs(curve: Curve, tolerance: number): Segment[] {
  const out: Segment[] = [];

  /** The direction at one end of a piece, as a unit vector. */
  function direction(t: number, other: number, before: boolean): Point {
    const [x, y] = curve.along(t, before);
    const here = curve.at(t);
    const there = curve.at(other);
    const length = Math.hypot(x, y);
    const speed = Math.hypot(there[0] - here[0], there[1] - here[1]) / Math.abs(other - t);
    if (length > 1e-9 * speed) return [x / length, y / length];
    // Where it stands still for a moment, the direction is that of a short step inwards.
    const near = curve.at(t + (other - t) * 1e-4);
    const way = before ? -1 : 1;
    const step: Point = [way * (near[0] - here[0]), way * (near[1] - here[1])];
    const size = Math.hypot(step[0], step[1]);
    return size > 0 ? [step[0] / size, step[1] / size] : [1, 0];
  }

  function piece(t0: number, t1: number, depth: number): void {
    const from = curve.at(t0);
    const to = curve.at(t1);
    const leave = direction(t0, t1, false);
    const arrive = direction(t1, t0, true);
    const samples: Point[] = [];
    for (let k = 1; k <= SAMPLES; k++) {
      samples.push(curve.at(t0 + ((t1 - t0) * k) / (SAMPLES + 1)));
    }
    const near = (segments: Segment[]): boolean =>
      samples.every(
        (sample) =>
          Math.min(...segments.map((segment) => distanceTo(segment, sample))) <= tolerance,
      );

    const one = leaving(from, leave, to, tolerance);
    if (one) {
      const end = arriving(one);
      const whole = one.kind === "line" || Math.abs(one.sweep) <= Math.PI;
      if (whole && Math.abs(cross(end, arrive)) < 1e-9 && dot(end, arrive) > 0 && near([one])) {
        out.push(one);
        return;
      }
    }
    const two = biarc(from, leave, to, arrive, tolerance);
    if (two && near(two)) {
      out.push(...two);
      return;
    }
    if (depth >= DEEPEST) {
      // Too small to tell from a line by now.
      if (from[0] !== to[0] || from[1] !== to[1]) {
        out.push({ kind: "line", ax: from[0], ay: from[1], bx: to[0], by: to[1] });
      }
      return;
    }
    const half = (t0 + t1) / 2;
    piece(t0, half, depth + 1);
    piece(half, t1, depth + 1);
  }

  for (let k = 0; k + 1 < curve.breaks.length; k++) {
    const t0 = curve.breaks[k] as number;
    const t1 = curve.breaks[k + 1] as number;
    if (t1 > t0) piece(t0, t1, 0);
  }
  return out;
}

/**
 * Part of an ellipse: from its centre, `a` reaches to where the parameter is 0 and
 * `b` to where it is a quarter turn. It runs from the parameter `start` on by `sweep`.
 */
export function ellipseCurve(
  centre: Point,
  a: Point,
  b: Point,
  start: number,
  sweep: number,
): Curve {
  const breaks = [start];
  // Cut where it crosses its own axes, so that what is alike is replaced alike.
  for (let k = Math.floor(start / (Math.PI / 2)) + 1; (k * Math.PI) / 2 < start + sweep; k++) {
    const t = (k * Math.PI) / 2;
    if (t - start > 1e-9 && start + sweep - t > 1e-9) breaks.push(t);
  }
  breaks.push(start + sweep);
  return {
    at: (t) => [
      centre[0] + a[0] * Math.cos(t) + b[0] * Math.sin(t),
      centre[1] + a[1] * Math.cos(t) + b[1] * Math.sin(t),
    ],
    along: (t) => [
      -a[0] * Math.sin(t) + b[0] * Math.cos(t),
      -a[1] * Math.sin(t) + b[1] * Math.cos(t),
    ],
    breaks,
  };
}

/** The value at a parameter of a spline whose control points have any number of coordinates. */
function deBoor(
  degree: number,
  knots: number[],
  control: number[][],
  t: number,
  before: boolean,
): number[] {
  const last = control.length - 1;
  let span = degree;
  const knot = (i: number): number => knots[i] as number;
  // At a knot, the stretch after it, or the one before it when that is asked for.
  while (span < last && (before ? knot(span + 1) < t : knot(span + 1) <= t)) span++;
  const d = control.slice(span - degree, span + 1).map((point) => [...point]);
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + span - degree;
      const alpha = (t - knot(i)) / (knot(i + degree - r + 1) - knot(i));
      const low = d[j - 1] as number[];
      const high = d[j] as number[];
      d[j] = high.map((value, n) => (1 - alpha) * (low[n] as number) + alpha * value);
    }
  }
  return d[degree] as number[];
}

/**
 * A spline as CAD writes it: its degree, its knots, and its control points, each
 * with a weight when some pull harder than others. Nothing when the numbers do not
 * make a spline.
 */
export function splineCurve(
  degree: number,
  knots: number[],
  points: Point[],
  weights?: number[],
): Curve | undefined {
  const count = points.length;
  if (!Number.isInteger(degree) || degree < 1 || count < degree + 1) return undefined;
  if (knots.length !== count + degree + 1) return undefined;
  if (knots.some((knot, i) => !Number.isFinite(knot) || (i > 0 && knot < (knots[i - 1] as number))))
    return undefined;
  if (weights?.some((weight) => !(weight > 0))) return undefined;
  const t0 = knots[degree] as number;
  const t1 = knots[count] as number;
  if (!(t1 > t0)) return undefined;

  // With its weight as a third coordinate, a weighted spline is a plain one.
  const control = points.map(([x, y], i) => {
    const weight = weights?.[i] ?? 1;
    return [x * weight, y * weight, weight];
  });
  // The spline of one degree less that says how fast the first one changes.
  const rates = control.slice(1).map((point, i) => {
    const width = (knots[i + degree + 1] as number) - (knots[i + 1] as number);
    return point.map((value, n) =>
      width > 0 ? (degree * (value - ((control[i] as number[])[n] as number))) / width : 0,
    );
  });
  const inner = knots.slice(1, -1);

  const breaks = [t0];
  for (let i = degree + 1; i < count; i++) {
    const knot = knots[i] as number;
    if (knot <= t0 || knot >= t1 || knot === breaks.at(-1)) continue;
    // A knot given as often as the degree is where the spline may turn a corner.
    if (knots.filter((other) => other === knot).length >= degree) breaks.push(knot);
  }
  breaks.push(t1);

  return {
    at(t) {
      const [x, y, w] = deBoor(degree, knots, control, t, false) as [number, number, number];
      return [x / w, y / w];
    },
    along(t, before) {
      const [x, y, w] = deBoor(degree, knots, control, t, before) as [number, number, number];
      const [dx, dy, dw] = deBoor(degree - 1, inner, rates, t, before) as [number, number, number];
      return [dx - (dw * x) / w, dy - (dw * y) / w];
    },
    breaks,
  };
}
