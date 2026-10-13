import { describe, expect, it } from "vitest";
import { intersections } from "../src/geometry/intersect.ts";
import { checkLoops, shapeOf } from "../src/geometry/outline.ts";
import { arcBetween, OutlineError, parsePath, writePath } from "../src/geometry/path.ts";
import {
  circleLoop,
  endOf,
  insideShape,
  type Loop,
  loopArea,
  loopBounds,
  placeLoop,
  reach,
  type Segment,
  startOf,
  windingOf,
} from "../src/geometry/shape.ts";

const SQUARE = "M 0 0 L 10 0 L 10 10 L 0 10 Z";
/** A slot: two straight sides with a half circle at each end. */
const SLOT = "M 0 -5 L 20 -5 A 5 5 0 0 1 20 5 L 0 5 A 5 5 0 0 1 0 -5 Z";

function failure(run: () => unknown): OutlineError {
  try {
    run();
  } catch (error) {
    if (error instanceof OutlineError) return error;
    throw error;
  }
  throw new Error("Expected an OutlineError");
}

const one = (text: string): Loop => parsePath(text)[0] as Loop;
const arc = (segment: Segment | undefined) => segment as Segment & { kind: "arc" };

describe("reading path text", () => {
  it("reads lines to places, and closes the outline with Z", () => {
    const loop = one(SQUARE);
    expect(loop.segments).toHaveLength(4);
    expect(loop.segments.at(-1)).toEqual({ kind: "line", ax: 0, ay: 10, bx: 0, by: 0 });
  });

  it("reads steps, lines along x and y, and numbers that follow on", () => {
    expect(one("m 0 0 h 10 v 10 h -10 z")).toEqual(one(SQUARE));
    expect(one("M0,0 10,0 10,10 0,10Z")).toEqual(one(SQUARE));
    expect(one("M 0 0 H 10 V 10 H 0 Z")).toEqual(one(SQUARE));
  });

  it("reads several outlines", () => {
    expect(parsePath(`${SQUARE} M 2 2 L 2 4 L 4 4 Z`)).toHaveLength(2);
  });

  it("finds the centre of an arc given by its ends", () => {
    const loop = one(SLOT);
    const right = arc(loop.segments[1]);
    expect(right.cx).toBeCloseTo(20, 12);
    expect(right.cy).toBeCloseTo(0, 12);
    expect(right.sweep).toBeCloseTo(Math.PI, 12);
    expect(arc(loop.segments[3]).cx).toBeCloseTo(0, 12);
  });

  it("takes the short or the long way round, either way", () => {
    const from: [number, number] = [1, 0];
    const to: [number, number] = [0, 1];
    const cases = [
      { large: false, sweep: true, centre: [0, 0], turned: Math.PI / 2 },
      { large: true, sweep: true, centre: [1, 1], turned: (3 * Math.PI) / 2 },
      { large: false, sweep: false, centre: [1, 1], turned: -Math.PI / 2 },
      { large: true, sweep: false, centre: [0, 0], turned: (-3 * Math.PI) / 2 },
    ];
    for (const { large, sweep, centre, turned } of cases) {
      const found = arc(arcBetween(from, to, 1, large, sweep));
      expect([found.cx, found.cy].map((v) => Number(v.toFixed(12)) + 0)).toEqual(centre);
      expect(found.sweep).toBeCloseTo(turned, 12);
      expect(endOf(found)[0]).toBeCloseTo(0, 12);
      expect(endOf(found)[1]).toBeCloseTo(1, 12);
    }
  });

  it("reads the two figures of an arc without a gap between them", () => {
    expect(one("M 0 -5 L 20 -5 A 5 5 0 0120 5 L 0 5 A 5 5 0 010-5 Z")).toEqual(one(SLOT));
  });

  it("says what is wrong, and where", () => {
    expect(failure(() => parsePath("M 0 0 L 10 0 L 10 10")).message).toBe(
      "The outline that starts at (0, 0) is not closed: end it with Z",
    );
    expect(failure(() => parsePath("M 0 0 L 10 0 M 5 5 L 6 6 Z")).pos).toBe(0);
    expect(failure(() => parsePath("M 0 0 C 1 1 2 2 3 3 Z")).message).toContain(
      '"C" is not one of M, L, H, V, A and Z',
    );
    expect(failure(() => parsePath("M 0 0 A 2 2 0 0 1 10 0 Z")).message).toBe(
      "An arc of radius 2 cannot reach from (0, 0) to (10, 0), which are 10 apart",
    );
    expect(failure(() => parsePath("M 0 0 A 5 3 0 0 1 10 0 Z")).message).toContain(
      "An arc is part of a circle",
    );
    expect(failure(() => parsePath("M 0 0 L 10")).message).toBe(
      'The path ends in the middle of "L"',
    );
    expect(failure(() => parsePath("M 0 0 L 0 0 Z")).message).toBe("A line at (0, 0) goes nowhere");
    expect(failure(() => parsePath("L 1 1 Z")).message).toBe(
      'An outline starts with M, not with "L"',
    );
    expect(failure(() => parsePath("  ")).message).toBe("The path is empty");
    expect(failure(() => parsePath("M 0 0 L 10 0 L 10 10 Z x")).pos).toBe(23);
  });
});

describe("writing path text", () => {
  it("gives back what it read", () => {
    for (const text of [SQUARE, SLOT, `${SQUARE} M 2 2 L 2 4 L 4 4 Z`]) {
      expect(writePath(parsePath(text))).toBe(text);
      expect(parsePath(writePath(parsePath(text)))).toEqual(parsePath(text));
    }
  });

  it("writes a whole circle as two arcs, which read back as the same circle", () => {
    const text = writePath([circleLoop(3, 4, 2, false)]);
    expect(text).toBe("M 5 4 A 2 2 0 0 1 1 4 A 2 2 0 0 1 5 4 Z");
    const back = parsePath(text)[0] as Loop;
    expect(loopArea(back)).toBeCloseTo(Math.PI * 4, 10);
    expect(arc(back.segments[0]).cx).toBeCloseTo(3, 12);
  });
});

describe("what an outline measures", () => {
  it("has its area, positive going anticlockwise", () => {
    expect(loopArea(one(SQUARE))).toBe(100);
    expect(loopArea(one("M 0 0 L 0 10 L 10 10 L 10 0 Z"))).toBe(-100);
    expect(loopArea(one(SLOT))).toBeCloseTo(200 + Math.PI * 25, 10);
    expect(loopArea(circleLoop(7, -3, 2))).toBeCloseTo(-Math.PI * 4, 12);
  });

  it("has its bounds, with the bulge of an arc", () => {
    expect(loopBounds(one(SLOT))).toEqual({ minX: -5, maxX: 25, minY: -5, maxY: 5 });
    const { minX, maxX } = loopBounds(circleLoop(1, 1, 3));
    expect([minX, maxX]).toEqual([-2, 4]);
  });

  it("has its furthest reach from the origin", () => {
    expect(reach(one(SQUARE))).toBeCloseTo(Math.hypot(10, 10), 12);
    expect(reach(one(SLOT))).toBeCloseTo(25, 12);
    expect(reach(circleLoop(0, 0, 4))).toBeCloseTo(4, 12);
  });

  it("knows what is inside it, exactly at an arc", () => {
    const slot = one(SLOT);
    expect(windingOf(slot, 10, 0)).toBe(1);
    expect(windingOf(slot, 24.999, 0)).toBe(1);
    expect(windingOf(slot, 25.001, 0)).toBe(0);
    // Just outside the round end, but inside the box round it.
    expect(windingOf(slot, 24, 4)).toBe(0);
    expect(windingOf(slot, 23.5, 3.5)).toBe(1);
    expect(windingOf(circleLoop(0, 0, 1), 0.5, 0.5)).toBe(-1);
    expect(windingOf(circleLoop(0, 0, 1), 1, 1)).toBe(0);
  });

  it("is laid down somewhere else: scaled, mirrored, turned and moved", () => {
    const slot = one(SLOT);
    const placed = placeLoop(slot, { x: 0.1, y: 50, angle: Math.PI / 2, scale: 0.001 });
    expect(loopArea(placed) / ((200 + Math.PI * 25) * 1e-6)).toBeCloseTo(1, 9);
    const box = loopBounds(placed);
    expect(box.minY).toBeCloseTo(50 - 0.005, 12);
    expect(box.maxY).toBeCloseTo(50 + 0.025, 12);
    const mirrored = placeLoop(slot, { mirror: true });
    expect(loopArea(mirrored)).toBeCloseTo(-loopArea(slot), 10);
    expect(loopBounds(mirrored).minX).toBeCloseTo(-25, 12);
    mirrored.segments.forEach((segment, i) => {
      const next = mirrored.segments[(i + 1) % mirrored.segments.length] as Segment;
      expect(endOf(segment)[0]).toBeCloseTo(startOf(next)[0], 12);
      expect(endOf(segment)[1]).toBeCloseTo(startOf(next)[1], 12);
    });
  });
});

describe("where segments meet", () => {
  const line = (ax: number, ay: number, bx: number, by: number): Segment => ({
    kind: "line",
    ax,
    ay,
    bx,
    by,
  });
  const quarter: Segment = { kind: "arc", cx: 0, cy: 0, r: 5, start: 0, sweep: Math.PI / 2 };

  it("finds where two lines cross, and that they do not", () => {
    expect(intersections(line(0, 0, 10, 10), line(0, 10, 10, 0))).toEqual([[5, 5]]);
    expect(intersections(line(0, 0, 10, 10), line(20, 0, 30, 10))).toEqual([]);
    expect(intersections(line(0, 0, 4, 4), line(0, 10, 10, 0))).toEqual([]);
  });

  it("finds lines that lie along each other", () => {
    expect(intersections(line(0, 0, 10, 0), line(5, 0, 20, 0))).toEqual([[7.5, 0]]);
    expect(intersections(line(0, 0, 10, 0), line(11, 0, 20, 0))).toEqual([]);
    expect(intersections(line(0, 0, 10, 0), line(0, 1, 10, 1))).toEqual([]);
  });

  it("finds where a line meets an arc, within the arc's span only", () => {
    const hits = intersections(line(-10, 3, 10, 3), quarter);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.[0]).toBeCloseTo(4, 12);
    expect(intersections(line(-10, -3, 10, -3), quarter)).toEqual([]);
    // Touching at one point.
    expect(intersections(line(5, -5, 5, 5), quarter)).toHaveLength(1);
  });

  it("finds where two arcs meet", () => {
    const other: Segment = { kind: "arc", cx: 6, cy: 0, r: 5, start: Math.PI / 2, sweep: Math.PI };
    const hits = intersections(quarter, other);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.[0]).toBeCloseTo(3, 12);
    expect(hits[0]?.[1]).toBeCloseTo(4, 12);
    const apart: Segment = { kind: "arc", cx: 20, cy: 0, r: 5, start: 0, sweep: 6 };
    expect(intersections(quarter, apart)).toEqual([]);
  });
});

describe("a shape from its outlines", () => {
  const tolerance = 1e-6;

  it("takes the largest as the outside and the others as holes, whichever way they were drawn", () => {
    const loops = parsePath(`M 2 2 L 4 2 L 4 4 L 2 4 Z M 0 0 L 0 10 L 10 10 L 10 0 Z`);
    const shape = shapeOf([...loops, circleLoop(7, 7, 1, false)], tolerance);
    expect(loopArea(shape.outer)).toBe(100);
    expect(shape.holes.map((hole) => Math.sign(loopArea(hole)))).toEqual([-1, -1]);
    expect(shape.bounds).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
    expect(shape.radius).toBeCloseTo(Math.hypot(10, 10), 12);
    expect(insideShape(shape, 1, 1)).toBe(true);
    expect(insideShape(shape, 3, 3)).toBe(false);
    expect(insideShape(shape, 7, 7.5)).toBe(false);
    expect(insideShape(shape, 11, 5)).toBe(false);
  });

  it("refuses an outline that crosses itself, with the place", () => {
    const bow = failure(() => shapeOf(parsePath("M 0 0 L 10 10 L 10 0 L 0 10 Z"), tolerance));
    expect(bow.message).toBe("The outline crosses itself at (5, 5)");
    expect(bow.at).toEqual([5, 5]);
  });

  it("refuses outlines that cross each other, and a hole outside the part", () => {
    expect(
      failure(() => shapeOf(parsePath(`${SQUARE} M 8 4 L 14 4 L 14 6 L 8 6 Z`), tolerance)).message,
    ).toMatch(/^Two outlines cross at \(10, [46]\)$/);
    expect(
      failure(() => shapeOf(parsePath(`${SQUARE} M 20 0 L 22 0 L 22 2 Z`), tolerance)).message,
    ).toContain("lies outside the part's outline");
    expect(
      failure(() =>
        shapeOf([...parsePath(SQUARE), circleLoop(5, 5, 3), circleLoop(5, 5, 1)], tolerance),
      ).message,
    ).toBe("The hole at (6, 5) lies inside another hole");
  });

  it("refuses an outline that is open or has a segment of no length", () => {
    const open: Loop = {
      segments: [
        { kind: "line", ax: 0, ay: 0, bx: 10, by: 0 },
        { kind: "line", ax: 10, ay: 0, bx: 10, by: 10 },
        { kind: "line", ax: 10, ay: 10, bx: 1, by: 0 },
      ],
    };
    expect(failure(() => checkLoops([open], tolerance)).message).toBe(
      "The outline is open at (1, 0)",
    );
    const speck: Loop = { segments: [{ kind: "line", ax: 3, ay: 3, bx: 3, by: 3 }] };
    expect(failure(() => checkLoops([speck], tolerance)).message).toBe(
      "A segment at (3, 3) has no length",
    );
  });

  it("takes outlines with arcs that meet smoothly", () => {
    expect(() => shapeOf(parsePath(SLOT), tolerance)).not.toThrow();
    expect(() => shapeOf([circleLoop(0, 0, 5), circleLoop(1, 0, 2)], tolerance)).not.toThrow();
  });
});
