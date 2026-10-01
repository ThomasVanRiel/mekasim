import { describe, expect, it } from "vitest";
import { convexHull, type Point, plateOutline } from "./outline.ts";

/** Signed area; positive when counter-clockwise. */
function area(polygon: Point[]): number {
  return polygon.reduce((sum, [x, y], i) => {
    const [nx, ny] = polygon[(i + 1) % polygon.length] as Point;
    return sum + (x * ny - nx * y) / 2;
  }, 0);
}

describe("convexHull", () => {
  it("drops interior and collinear points", () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 2],
      [1, 1],
      [0, 2],
    ]);
    expect(hull).toHaveLength(4);
    expect(area(hull)).toBeCloseTo(4);
  });

  it("reduces points on one line to its two ends", () => {
    expect(
      convexHull([
        [0, 0],
        [0, 60],
        [0, 120],
        [0, -120],
      ]),
    ).toEqual([
      [0, -120],
      [0, 120],
    ]);
  });
});

describe("plateOutline", () => {
  it("draws a link with round ends around two points", () => {
    const outline = plateOutline(
      [
        [0, 0],
        [10, 0],
      ],
      1,
      360,
    );
    // A 10 x 2 rectangle plus a disc of radius 1.
    expect(area(outline)).toBeCloseTo(20 + Math.PI, 2);
    for (const [x, y] of outline) {
      const nearest = Math.min(Math.max(x, 0), 10);
      expect(Math.hypot(x - nearest, y)).toBeCloseTo(1, 9);
    }
  });

  it("draws a disc around a single point", () => {
    expect(area(plateOutline([[3, 4]], 2, 360))).toBeCloseTo(4 * Math.PI, 2);
  });

  it("grows a triangle outwards by the radius", () => {
    const outline = plateOutline(
      [
        [0, 0],
        [4, 0],
        [0, 3],
      ],
      0.5,
      360,
    );
    // Triangle area + perimeter * r + pi r^2.
    expect(area(outline)).toBeCloseTo(6 + 12 * 0.5 + Math.PI * 0.25, 2);
  });
});
