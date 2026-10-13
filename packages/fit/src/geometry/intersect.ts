import { alongArc, type Point, type Segment } from "./shape.ts";

type Line = Segment & { kind: "line" };
type Arc = Segment & { kind: "arc" };

/** Where a point lies along an arc counts as on it within this much of its ends. */
const SLACK = 1e-9;

function onArc(arc: Arc, x: number, y: number): boolean {
  const along = alongArc(arc, Math.atan2(y - arc.cy, x - arc.cx));
  return along <= 1 + SLACK || along >= (2 * Math.PI) / Math.abs(arc.sweep) - SLACK;
}

function lineLine(a: Line, b: Line, tolerance: number): Point[] {
  const rx = a.bx - a.ax;
  const ry = a.by - a.ay;
  const sx = b.bx - b.ax;
  const sy = b.by - b.ay;
  const qx = b.ax - a.ax;
  const qy = b.ay - a.ay;
  const cross = rx * sy - ry * sx;
  const la = Math.hypot(rx, ry);
  const lb = Math.hypot(sx, sy);
  if (la === 0 || lb === 0) return [];
  if (Math.abs(cross) > 1e-12 * la * lb) {
    const t = (qx * sy - qy * sx) / cross;
    const u = (qx * ry - qy * rx) / cross;
    const ta = tolerance / la;
    const tb = tolerance / lb;
    if (t < -ta || t > 1 + ta || u < -tb || u > 1 + tb) return [];
    return [[a.ax + t * rx, a.ay + t * ry]];
  }
  // Parallel. They meet only when they lie along one line and overlap there.
  if (Math.abs(qx * ry - qy * rx) / la > tolerance) return [];
  const t0 = (qx * rx + qy * ry) / (la * la);
  const t1 = t0 + (sx * rx + sy * ry) / (la * la);
  const from = Math.max(0, Math.min(t0, t1));
  const to = Math.min(1, Math.max(t0, t1));
  if (from > to + tolerance / la) return [];
  const mid = (from + to) / 2;
  return [[a.ax + mid * rx, a.ay + mid * ry]];
}

function lineArc(line: Line, arc: Arc, tolerance: number): Point[] {
  const dx = line.bx - line.ax;
  const dy = line.by - line.ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  // The foot of the centre on the line, and how far the centre is from it.
  const t = ((arc.cx - line.ax) * dx + (arc.cy - line.ay) * dy) / (length * length);
  const fx = line.ax + t * dx;
  const fy = line.ay + t * dy;
  const off = Math.hypot(arc.cx - fx, arc.cy - fy);
  if (off > arc.r + tolerance) return [];
  const half = Math.sqrt(Math.max(0, arc.r * arc.r - off * off)) / length;
  const slack = tolerance / length;
  const points: Point[] = [];
  for (const at of half < slack ? [t] : [t - half, t + half]) {
    if (at < -slack || at > 1 + slack) continue;
    const x = line.ax + at * dx;
    const y = line.ay + at * dy;
    if (onArc(arc, x, y)) points.push([x, y]);
  }
  return points;
}

function arcArc(a: Arc, b: Arc, tolerance: number): Point[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < tolerance && Math.abs(a.r - b.r) < tolerance) {
    // On one circle: they meet where one of them starts or ends on the other.
    const ends: Point[] = [];
    for (const [arc, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const angle of [arc.start, arc.start + arc.sweep]) {
        const x = arc.cx + arc.r * Math.cos(angle);
        const y = arc.cy + arc.r * Math.sin(angle);
        if (onArc(other, x, y)) ends.push([x, y]);
      }
    }
    return ends;
  }
  if (d > a.r + b.r + tolerance || d < Math.abs(a.r - b.r) - tolerance || d === 0) return [];
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const half = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const mx = a.cx + (along * dx) / d;
  const my = a.cy + (along * dy) / d;
  const points: Point[] = [];
  for (const side of half < tolerance ? [0] : [1, -1]) {
    const x = mx - (side * half * dy) / d;
    const y = my + (side * half * dx) / d;
    if (onArc(a, x, y) && onArc(b, x, y)) points.push([x, y]);
  }
  return points;
}

/**
 * The points two segments have in common, their ends included. Where they run along
 * each other for a stretch, one point of that stretch is given. `tolerance` is how
 * near counts as touching, in the unit of the coordinates.
 */
export function intersections(a: Segment, b: Segment, tolerance = 1e-9): Point[] {
  if (a.kind === "line") {
    return b.kind === "line" ? lineLine(a, b, tolerance) : lineArc(a, b, tolerance);
  }
  return b.kind === "line" ? lineArc(b, a, tolerance) : arcArc(a, b, tolerance);
}
