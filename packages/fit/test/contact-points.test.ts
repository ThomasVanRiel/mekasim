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

  it("measures faces that have passed each other as less than nothing, the same way round", () => {
    const passed = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.0099,
      y: 0,
      angle: 0,
    });
    expect(passed).toHaveLength(2);
    for (const point of passed) {
      expect(point.distance).toBeCloseTo(-0.0001, 12);
      expectPoint(point.normal, [1, 0]);
    }
    // And by a hair, where rounding alone may put one face behind the other.
    const hair = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.01 - 1e-11,
      y: 0,
      angle: 0,
    });
    for (const point of hair) expectPoint(point.normal, [1, 0]);
  });

  it("measures a corner inside the other shape by how deep it is", () => {
    // A square on its corner, the corner 0.1 mm into the top face of a box.
    const found = contactPoints(box(0.02, 0.01), HOME, box(0.005, 0.005), {
      x: 0.01,
      y: 0.0099,
      angle: Math.PI / 4,
    });
    expect(found[0]?.distance).toBeCloseTo(-0.0001, 12);
    expectPoint(found[0]?.normal as [number, number], [0, 1]);
    expectPoint(found[0]?.b as [number, number], [0.01, 0.0099]);
  });

  it("does not take two corners that are near each other for parts into each other", () => {
    // The upper right corner of one box 1 mm from the lower left corner of the other, both ways.
    const found = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.011,
      y: 0.011,
      angle: 0,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.distance).toBeCloseTo(Math.hypot(0.001, 0.001), 12);
    expectPoint(found[0]?.normal as [number, number], [Math.SQRT1_2, Math.SQRT1_2]);
  });

  it("holds a corner that touches a face square to the face", () => {
    // A square on its corner, the corner just on the top face of a box.
    const found = contactPoints(box(0.02, 0.01), HOME, box(0.005, 0.005), {
      x: 0.01,
      y: 0.01,
      angle: Math.PI / 3,
    });
    expect(found[0]?.distance).toBeCloseTo(0, 15);
    expectPoint(found[0]?.normal as [number, number], [0, 1]);
    // And the other way round: the normal still says which way the second gets clear.
    const turned = contactPoints(
      box(0.005, 0.005),
      { x: 0.01, y: 0.01, angle: Math.PI / 3 },
      box(0.02, 0.01),
      HOME,
    );
    expectPoint(turned[0]?.normal as [number, number], [0, -1]);
  });

  it("gives touching and crossing boundaries a finite unit normal", () => {
    const touching = contactPoints(box(0.01, 0.01), HOME, box(0.01, 0.01), {
      x: 0.01,
      y: 0,
      angle: 0,
    });
    // Faces that lie on each other still hold at both ends, squarely.
    expect(touching).toHaveLength(2);
    expect(touching.map(({ a }) => a[1]).sort()).toEqual([0, 0.01]);
    for (const point of touching) {
      expect(point.distance).toBeCloseTo(0, 15);
      expectPoint(point.normal, [1, 0]);
    }

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
