import { describe, expect, it } from "vitest";
import { type Curve, ellipseCurve, fitArcs, splineCurve } from "../src/geometry/fit.ts";
import {
  alongArc,
  endOf,
  type Point,
  pointAt,
  type Segment,
  startOf,
} from "../src/geometry/shape.ts";

function distance(segment: Segment, [x, y]: Point): number {
  if (segment.kind === "line") {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const t = Math.min(
      1,
      Math.max(0, ((x - segment.ax) * dx + (y - segment.ay) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(x - segment.ax - t * dx, y - segment.ay - t * dy);
  }
  if (alongArc(segment, Math.atan2(y - segment.cy, x - segment.cx)) <= 1) {
    return Math.abs(Math.hypot(x - segment.cx, y - segment.cy) - segment.r);
  }
  return Math.min(
    ...[startOf(segment), endOf(segment)].map(([px, py]) => Math.hypot(x - px, y - py)),
  );
}

/** The furthest the curve gets from the segments that stand for it, looked at closely. */
function furthest(curve: Curve, segments: Segment[]): number {
  const from = curve.breaks[0] as number;
  const to = curve.breaks.at(-1) as number;
  let worst = 0;
  for (let k = 0; k <= 5000; k++) {
    const at = curve.at(from + ((to - from) * k) / 5000);
    worst = Math.max(worst, Math.min(...segments.map((segment) => distance(segment, at))));
  }
  return worst;
}

/** The direction a segment has at its start (false) or its end (true). */
function heading(segment: Segment, atEnd: boolean): number {
  if (segment.kind === "line") return Math.atan2(segment.by - segment.ay, segment.bx - segment.ax);
  const angle = segment.start + (atEnd ? segment.sweep : 0);
  return angle + (segment.sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** The sharpest turn between one segment and the next, in radians. */
function sharpest(segments: Segment[], closed: boolean): number {
  let worst = 0;
  segments.forEach((segment, i) => {
    if (!closed && i === segments.length - 1) return;
    const next = segments[(i + 1) % segments.length] as Segment;
    const [ex, ey] = endOf(segment);
    const [sx, sy] = startOf(next);
    expect(Math.hypot(ex - sx, ey - sy)).toBeLessThan(1e-9);
    const turn = heading(next, false) - heading(segment, true);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))));
  });
  return worst;
}

describe("replacing curves by arcs", () => {
  it("keeps within the tolerance of an ellipse, without corners", () => {
    const ellipse = ellipseCurve([10, 5], [40, 0], [0, 20], 0, 2 * Math.PI);
    const fine = fitArcs(ellipse, 0.002);
    expect(furthest(ellipse, fine)).toBeLessThan(0.002 * 1.05);
    expect(sharpest(fine, true)).toBeLessThan(1e-6);
    expect(fine.every((segment) => segment.kind === "arc")).toBe(true);
    // Alike in each quarter, and no more arcs than the tolerance asks for.
    expect(fine.length % 4).toBe(0);
    expect(fine.length).toBeLessThanOrEqual(96);
    const coarse = fitArcs(ellipse, 0.2);
    expect(coarse.length).toBeLessThan(fine.length);
    expect(furthest(ellipse, coarse)).toBeLessThan(0.2 * 1.05);
  });

  it("gives back a circle's own arcs", () => {
    const arcs = fitArcs(ellipseCurve([3, 4], [0, 5], [-5, 0], 0.3, 2), 0.002);
    expect(arcs.length).toBeLessThanOrEqual(2);
    for (const arc of arcs as (Segment & { kind: "arc" })[]) {
      expect(arc.kind).toBe("arc");
      expect(arc.cx).toBeCloseTo(3, 9);
      expect(arc.cy).toBeCloseTo(4, 9);
      expect(arc.r).toBeCloseTo(5, 9);
    }
    expect(arcs.reduce((sum, arc) => sum + (arc as { sweep: number }).sweep, 0)).toBeCloseTo(2, 9);
  });

  it("follows a spline between its ends", () => {
    // One span of degree three: a Bézier curve with these four control points.
    const control: Point[] = [
      [0, 0],
      [10, 30],
      [40, -20],
      [50, 10],
    ];
    const spline = splineCurve(3, [0, 0, 0, 0, 1, 1, 1, 1], control) as Curve;
    const [x, y] = spline.at(0.5);
    expect(x).toBeCloseTo((0 + 3 * 10 + 3 * 40 + 50) / 8, 12);
    expect(y).toBeCloseTo((0 + 3 * 30 + 3 * -20 + 10) / 8, 12);
    const segments = fitArcs(spline, 0.002);
    expect(Math.hypot(...startOf(segments[0] as Segment))).toBeLessThan(1e-9);
    expect(endOf(segments.at(-1) as Segment)[0]).toBeCloseTo(50, 9);
    expect(endOf(segments.at(-1) as Segment)[1]).toBeCloseTo(10, 9);
    expect(furthest(spline, segments)).toBeLessThan(0.002 * 1.05);
    expect(sharpest(segments, false)).toBeLessThan(1e-6);
    // It leaves along the first side of its control points.
    expect(heading(segments[0] as Segment, false)).toBeCloseTo(Math.atan2(30, 10), 9);
  });

  it("keeps a spline's own corners, and makes lines of a spline of straight sides", () => {
    // Two parabolas that meet in a corner at (10, 0): the knot 1 is given twice.
    const cornered = splineCurve(
      2,
      [0, 0, 0, 1, 1, 2, 2, 2],
      [
        [0, 0],
        [5, 10],
        [10, 0],
        [15, 10],
        [20, 0],
      ],
    ) as Curve;
    expect(cornered.breaks).toEqual([0, 1, 2]);
    const segments = fitArcs(cornered, 0.002);
    expect(furthest(cornered, segments)).toBeLessThan(0.002 * 1.05);
    expect(sharpest(segments, false)).toBeCloseTo(2 * Math.atan2(10, 5), 6);

    const straight = splineCurve(
      1,
      [0, 0, 1, 2, 2],
      [
        [0, 0],
        [10, 0],
        [10, 5],
      ],
    ) as Curve;
    expect(fitArcs(straight, 0.002)).toEqual([
      { kind: "line", ax: 0, ay: 0, bx: 10, by: 0 },
      { kind: "line", ax: 10, ay: 0, bx: 10, by: 5 },
    ]);
  });

  it("reads the weights of a spline that is an arc", () => {
    const quarter = splineCurve(
      2,
      [0, 0, 0, 1, 1, 1],
      [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [1, Math.SQRT1_2, 1],
    ) as Curve;
    const segments = fitArcs(quarter, 1e-6);
    expect(segments).toHaveLength(1);
    const [arc] = segments as (Segment & { kind: "arc" })[];
    expect([arc?.cx, arc?.cy, arc?.r].map((value) => Number(value?.toFixed(9)))).toEqual([0, 0, 1]);
    expect(arc?.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(pointAt(arc as Segment & { kind: "arc" }, (arc as { start: number }).start)[0]).toBe(1);
  });

  it("does not take numbers that make no spline", () => {
    const points: Point[] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(splineCurve(2, [0, 0, 0, 1, 1], points)).toBeUndefined();
    expect(splineCurve(3, [0, 0, 0, 0, 1, 1, 1], points)).toBeUndefined();
    expect(splineCurve(2, [0, 0, 0, 1, 1, 1], points, [1, 0, 1])).toBeUndefined();
    expect(splineCurve(2, [0, 0, 0, 0, 0, 0], points)).toBeUndefined();
  });
});
