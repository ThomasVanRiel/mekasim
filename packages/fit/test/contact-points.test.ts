import { circleLoop, parsePath, type Shape, shapeOf } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { contactPoints } from "../src/geometry/contacts.ts";

const HOME = { x: 0, y: 0, angle: 0 };
const box = (width: number, height: number): Shape =>
  shapeOf(parsePath(`M 0 0 H ${width} V ${height} H 0 Z`), 1e-12);
const disc = (radius: number): Shape => shapeOf([circleLoop(0, 0, radius, false)], 1e-12);
const washer = (outside: number, hole: number): Shape =>
  shapeOf([circleLoop(0, 0, outside, false), circleLoop(0, 0, hole)], 1e-12);

function expectPoint(actual: readonly number[], expected: readonly number[]): void {
  expect(actual[0]).toBeCloseTo(expected[0] as number, 12);
  expect(actual[1]).toBeCloseTo(expected[1] as number, 12);
}

describe("contact points between two shapes", () => {
  it("keeps both ends of two nearby flat faces and merges shared-corner duplicates", () => {
    const found = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.011,
      y: 0,
      angle: 0,
    });
    expect(found).toHaveLength(2);
    for (const { distance } of found) expect(distance).toBeCloseTo(0.001, 12);
    expect(found.map(({ a }) => a[1]).sort()).toEqual([0, 0.01]);
    for (const point of found) {
      expectPoint(point.normal, [1, 0]);
      expect(Math.hypot(...point.normal)).toBeCloseTo(1, 12);
    }
  });

  it("returns nothing beyond the margin", () => {
    expect(
      contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), { x: 0.011, y: 0, angle: 0 }, 0.0005),
    ).toEqual([]);
  });

  it("measures arcs exactly, including the boundary of a hole", () => {
    const circles = contactPoints(disc(0.003), HOME, disc(0.002), { x: 0.006, y: 0, angle: 1 });
    expect(circles).toHaveLength(1);
    expect(circles[0]?.distance).toBeCloseTo(0.001, 12);
    expectPoint(circles[0]?.normal as [number, number], [1, 0]);

    const pin = contactPoints(washer(0.01, 0.003), HOME, disc(0.002), HOME);
    expect(pin).toHaveLength(1);
    expect(pin[0]?.distance).toBeCloseTo(0.001, 12);
  });

  it("gives touching and crossing boundaries a finite unit normal", () => {
    const touching = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.01,
      y: 0,
      angle: 0,
    });
    // Coincident faces have a third exact answer in their middle; both ends remain present.
    expect(touching).toHaveLength(3);
    expect(touching.map(({ a }) => a[1]).sort()).toEqual([0, 0.005, 0.01]);
    expect(touching.some(({ normal }) => Math.abs(normal[0] - 1) < 1e-12)).toBe(true);
    for (const point of touching) expect(Math.hypot(...point.normal)).toBeCloseTo(1, 12);

    const crossing = contactPoints(box(0.01, 0.01), HOME, box(0.008, 0.008), {
      x: 0.008,
      y: 0.005,
      angle: Math.PI / 4,
    });
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.length).toBeLessThanOrEqual(4);
    for (const point of crossing) {
      expect(point.normal.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...point.normal)).toBeCloseTo(1, 12);
    }
  });
});
