import { describe, expect, it } from "vitest";
import { gap, nearest, nearestOn, nearestOnShape, type Pose } from "../src/geometry/distance.ts";
import { parsePath } from "../src/geometry/path.ts";
import {
  circleLoop,
  endOf,
  lengthOf,
  type Point,
  pointAt,
  type Segment,
  type Shape,
  startOf,
} from "../src/geometry/shape.ts";
import { treeOf } from "../src/geometry/tree.ts";
import { shapeOf } from "../src/geometry/validate.ts";

/** Numbers between 0 and 1 that come the same every time. */
function numbers(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function along(segment: Segment, t: number): Point {
  if (segment.kind === "line") {
    return [segment.ax + t * (segment.bx - segment.ax), segment.ay + t * (segment.by - segment.ay)];
  }
  return pointAt(segment, segment.start + t * segment.sweep);
}

/** The distance between two segments found the slow way: from many places along the first. */
function slowly(a: Segment, b: Segment, steps: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= steps; k++) {
    const p = along(a, k / steps);
    const q = nearestOn(b, p);
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return best;
}

function some(random: () => number): Segment {
  const span = (): number => (random() - 0.5) * 20;
  if (random() < 0.5) return { kind: "line", ax: span(), ay: span(), bx: span(), by: span() };
  return {
    kind: "arc",
    cx: span(),
    cy: span(),
    r: 0.5 + random() * 8,
    start: random() * 7,
    sweep: (random() < 0.5 ? -1 : 1) * (0.1 + random() * 6.18),
  };
}

const on = (segment: Segment, point: Point): number => {
  const at = nearestOn(segment, point);
  return Math.hypot(at[0] - point[0], at[1] - point[1]);
};

describe("the distance between two segments", () => {
  it("is that found the slow way, for lines and arcs of every kind", () => {
    const random = numbers(7);
    const kinds = new Set<string>();
    let touching = 0;
    for (let n = 0; n < 600; n++) {
      const a = some(random);
      const b = some(random);
      kinds.add(`${a.kind} ${b.kind}`);
      const found = nearest(a, b);
      const steps = 4000;
      const slow = Math.min(slowly(a, b, steps), slowly(b, a, steps));
      // Never further than the slow way finds, and no nearer than its steps can miss.
      expect(found.d).toBeLessThanOrEqual(slow + 1e-9);
      expect(found.d).toBeGreaterThanOrEqual(slow - (lengthOf(a) + lengthOf(b)) / steps);
      // The two places are on their segments, and as far apart as said.
      expect(on(a, found.pa)).toBeLessThan(1e-9);
      expect(on(b, found.pb)).toBeLessThan(1e-9);
      expect(Math.hypot(found.pa[0] - found.pb[0], found.pa[1] - found.pb[1])).toBeCloseTo(
        found.d,
        9,
      );
      if (found.d === 0) touching++;
    }
    expect(kinds.size).toBe(4);
    expect(touching).toBeGreaterThan(50);
    expect(touching).toBeLessThan(550);
  });

  it("is measured between the middles where an arc faces a line or another arc", () => {
    const arc: Segment = { kind: "arc", cx: 0, cy: 5, r: 2, start: Math.PI, sweep: Math.PI };
    const line: Segment = { kind: "line", ax: -10, ay: 0, bx: 10, by: 0 };
    const down = nearest(arc, line);
    expect(down.d).toBeCloseTo(3, 12);
    expect(down.pa[0]).toBeCloseTo(0, 12);
    expect(down.pa[1]).toBeCloseTo(3, 12);
    expect(down.pb[0]).toBeCloseTo(0, 12);
    expect(down.pb[1]).toBe(0);

    const other: Segment = { kind: "arc", cx: 10, cy: 5, r: 3, start: Math.PI / 2, sweep: Math.PI };
    const across = nearest({ ...arc, start: -Math.PI / 2 }, other);
    expect(across.d).toBeCloseTo(5, 12);
    expect(across.pa[0]).toBeCloseTo(2, 12);
    expect(across.pb[0]).toBeCloseTo(7, 12);
    // Inside a larger arc, the nearest is on the far side from its centre.
    const ring: Segment = { kind: "arc", cx: 1, cy: 5, r: 6, start: 0, sweep: 2 * Math.PI };
    const inside = nearest({ ...arc, start: 0, sweep: 2 * Math.PI }, ring);
    expect(inside.d).toBeCloseTo(3, 12);
    expect(inside.pa[0]).toBeCloseTo(-2, 12);
    expect(inside.pb[0]).toBeCloseTo(-5, 12);
  });

  it("is nothing where they cross, with the place", () => {
    const found = nearest(
      { kind: "line", ax: 0, ay: 0, bx: 4, by: 4 },
      { kind: "line", ax: 0, ay: 4, bx: 4, by: 0 },
    );
    expect(found).toEqual({ d: 0, pa: [2, 2], pb: [2, 2] });
  });
});

const TOLERANCE = 1e-9;
const box = (w: number, h: number): Shape =>
  shapeOf(parsePath(`M 0 0 H ${w} V ${h} H 0 Z`), TOLERANCE);
const disc = (r: number): Shape => shapeOf([circleLoop(0, 0, r, false)], TOLERANCE);
const washer = (r: number, hole: number): Shape =>
  shapeOf([circleLoop(0, 0, r, false), circleLoop(0, 0, hole)], TOLERANCE);
/** A link with rounded ends and a hole in each, 60 long. */
const link = shapeOf(
  parsePath(
    "M 0 -8 L 60 -8 A 8 8 0 0 1 60 8 L 0 8 A 8 8 0 0 1 0 -8 Z M 3 0 A 3 3 0 1 0 -3 0 A 3 3 0 1 0 3 0 Z M 63 0 A 3 3 0 1 0 57 0 A 3 3 0 1 0 63 0 Z",
  ),
  TOLERANCE,
);
const at = (x: number, y: number, angle = 0): Pose => ({ x, y, angle });
const HOME = at(0, 0);

describe("the gap between two shapes", () => {
  it("is the distance between their nearest places, on the sheet", () => {
    const found = gap(box(10, 10), HOME, box(10, 4), at(13, 2));
    expect(found?.distance).toBeCloseTo(3, 12);
    expect(found?.a[0]).toBeCloseTo(10, 12);
    expect(found?.b[0]).toBeCloseTo(13, 12);
    expect(found?.a[1]).toBeCloseTo(found?.b[1] as number, 12);
  });

  it("follows the shapes as their bodies move and turn", () => {
    // A square turned onto its corner, the corner pointing at the first one's side.
    const found = gap(box(10, 10), at(100, 50, Math.PI / 2), box(4, 4), at(105, 55, -Math.PI / 4));
    expect(found?.distance).toBeCloseTo(5, 12);
    expect(found?.a).toEqual([100, 55]);
    expect(found?.b[0]).toBeCloseTo(105, 12);
    expect(found?.b[1]).toBeCloseTo(55, 12);
    // The same whichever of the two is asked first.
    const back = gap(box(4, 4), at(105, 55, -Math.PI / 4), box(10, 10), at(100, 50, Math.PI / 2));
    expect(back?.distance).toBeCloseTo(5, 12);
    expect(back?.b[0]).toBeCloseTo(100, 12);
  });

  it("is the play of a pin in its hole", () => {
    const found = gap(washer(10, 3), at(20, 20, 1), disc(2.75), at(20.1, 20, -2));
    expect(found?.distance).toBeCloseTo(0.15, 12);
    expect(found?.a[0]).toBeCloseTo(23, 12);
    expect(found?.b[0]).toBeCloseTo(22.85, 12);
    expect(gap(washer(10, 3), HOME, disc(2.75), HOME)?.distance).toBeCloseTo(0.25, 12);
  });

  it("is less than nothing where they overlap, by how deep", () => {
    const corner = gap(box(10, 10), HOME, box(10, 4), at(9.7, 2));
    expect(corner?.distance).toBeCloseTo(-0.3, 12);
    // A round end pressed into a flat side: its deepest place is not a corner.
    const bulge = gap(box(10, 10), HOME, disc(2), at(11.8, 5));
    expect(bulge?.distance).toBeCloseTo(-0.2, 12);
    expect(bulge?.b[0]).toBeCloseTo(9.8, 12);
    expect(bulge?.a[0]).toBeCloseTo(10, 12);
    const rounds = gap(disc(3), HOME, disc(2), at(4.5, 0));
    expect(rounds?.distance).toBeCloseTo(-0.5, 12);
    // A pin too thick for its hole.
    expect(gap(washer(10, 3), HOME, disc(3.1), at(0.05, 0))?.distance).toBeCloseTo(-0.15, 12);
  });

  it("is nothing where they only touch", () => {
    expect(gap(box(10, 10), HOME, box(10, 4), at(10, 2))?.distance).toBeCloseTo(0, 12);
    expect(gap(disc(3), HOME, disc(2), at(5, 0))?.distance).toBeCloseTo(0, 12);
  });

  it("is less than nothing for a part lying wholly in the material of another", () => {
    const found = gap(box(20, 20), HOME, disc(1), at(4, 10));
    expect(found?.distance).toBeCloseTo(-5, 12);
    expect(gap(disc(1), at(4, 10), box(20, 20), HOME)?.distance).toBeCloseTo(-5, 12);
  });

  it("is that of every pair of their segments, found the slow way", () => {
    const random = numbers(11);
    const segments = [link.outer, ...link.holes].flatMap((loop) => loop.segments);
    const placed = (pose: Pose): Segment[] =>
      segments.map((segment) => {
        const cos = Math.cos(pose.angle);
        const sin = Math.sin(pose.angle);
        const move = ([x, y]: Point): Point => [
          pose.x + x * cos - y * sin,
          pose.y + x * sin + y * cos,
        ];
        if (segment.kind === "line") {
          const [ax, ay] = move(startOf(segment));
          const [bx, by] = move(endOf(segment));
          return { kind: "line", ax, ay, bx, by };
        }
        const [cx, cy] = move([segment.cx, segment.cy]);
        return { ...segment, cx, cy, start: segment.start + pose.angle };
      });
    let apart = 0;
    for (let n = 0; n < 300; n++) {
      const poseA = at(random() * 50, random() * 50, random() * 7);
      const poseB = at(random() * 150, random() * 150, random() * 7);
      const found = gap(link, poseA, link, poseB);
      let slow = Number.POSITIVE_INFINITY;
      for (const sa of placed(poseA)) {
        for (const sb of placed(poseB)) slow = Math.min(slow, nearest(sa, sb).d);
      }
      if (slow > 0) {
        apart++;
        expect(found?.distance).toBeCloseTo(slow, 9);
        expect(
          Math.hypot(
            (found?.a[0] as number) - (found?.b[0] as number),
            (found?.a[1] as number) - (found?.b[1] as number),
          ),
        ).toBeCloseTo(slow, 9);
      } else {
        expect(found?.distance).toBeLessThanOrEqual(0);
      }
    }
    expect(apart).toBeGreaterThan(100);
    expect(apart).toBeLessThan(300);
  });

  it("leaves out what is further apart than asked", () => {
    expect(gap(box(10, 10), HOME, box(10, 4), at(13, 2), 2)).toBeUndefined();
    expect(gap(box(10, 10), HOME, box(10, 4), at(13, 2), 3.5)?.distance).toBeCloseTo(3, 12);
    expect(gap(box(10, 10), HOME, box(10, 4), at(500, 2), 2)).toBeUndefined();
  });
});

describe("the edge of a shape nearest to a point", () => {
  it("is that of its nearest segment, holes counted", () => {
    const random = numbers(3);
    const segments = [link.outer, ...link.holes].flatMap((loop) => loop.segments);
    for (let n = 0; n < 200; n++) {
      const point: Point = [random() * 100 - 20, random() * 60 - 30];
      const slow = Math.min(...segments.map((segment) => on(segment, point)));
      expect(nearestOnShape(link, point).d).toBeCloseTo(slow, 12);
    }
    expect(nearestOnShape(link, [1, 0]).d).toBeCloseTo(2, 12);
  });

  it("is looked for in a tree that holds every segment once", () => {
    const count = (tree: ReturnType<typeof treeOf>): number =>
      tree.segments
        ? tree.segments.length
        : count(tree.left as typeof tree) + count(tree.right as typeof tree);
    expect(count(treeOf(link))).toBe(8);
    expect(treeOf(link)).toBe(treeOf(link));
  });
});
