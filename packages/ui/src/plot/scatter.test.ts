import { describe, expect, it } from "vitest";
import { jitter, nearestPoint, type ScatterPoint, scatterLayout } from "./scatter.ts";

const BOX = { width: 400, height: 300, left: 50, right: 390, top: 10, bottom: 260 };

const POINTS: ScatterPoint[] = [
  { key: 0, x: -8, y: 0, kind: "passed" },
  { key: 1, x: 8, y: 45, kind: "failed" },
  { key: 2, x: 0, y: 20, kind: "before" },
  { key: 3, x: 1, y: 21, kind: "unsolved", faint: true },
];

describe("the scatter of a study's runs", () => {
  it("covers the given ranges, or the points' own, with round ends", () => {
    const own = scatterLayout(POINTS, BOX);
    expect(own.x.min).toBeLessThanOrEqual(-8);
    expect(own.x.max).toBeGreaterThanOrEqual(8);
    const given = scatterLayout(POINTS, BOX, [-10, 10], [0, 50]);
    expect([given.x.min, given.x.max]).toEqual([-10, 10]);
    expect([given.y.min, given.y.max]).toEqual([0, 50]);
    // Values grow rightwards and upwards.
    expect(given.toX(-10)).toBe(BOX.left);
    expect(given.toX(10)).toBe(BOX.right);
    expect(given.toY(0)).toBe(BOX.bottom);
    expect(given.toY(50)).toBe(BOX.top);
  });

  it("finds the run under the pointer, passing over earlier and faint ones", () => {
    const layout = scatterLayout(POINTS, BOX, [-10, 10], [0, 50]);
    const near = (x: number, y: number) =>
      nearestPoint(POINTS, layout, layout.toX(x), layout.toY(y))?.key;
    expect(near(8, 45)).toBe(1);
    expect(near(-8, 0.5)).toBe(0);
    expect(near(0, 20)).toBeUndefined();
    expect(near(1, 21)).toBeUndefined();
    expect(near(3, 30)).toBeUndefined();
  });

  it("moves runs at one value apart by a little, the same each time", () => {
    const offsets = Array.from({ length: 50 }, (_, key) => jitter(key, 10));
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(1.75);
    expect(new Set(offsets).size).toBe(50);
    expect(jitter(7, 10)).toBe(offsets[7]);
  });
});
