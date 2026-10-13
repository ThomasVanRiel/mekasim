import { describe, expect, it } from "vitest";
import { dimensionGeometry } from "./dimension.ts";
import { gridLines, gridStep } from "./grid.ts";
import {
  fitted,
  panned,
  toScreen,
  toWorld,
  type View,
  visible,
  worldTransform,
  zoomed,
} from "./view.ts";

const size = { width: 800, height: 600 };
const view: View = { x: 0.1, y: 0.05, scale: 2000 };

describe("the view of the sheet", () => {
  it("puts its own point at the middle, with y upwards", () => {
    expect(toScreen(view, size, 0.1, 0.05)).toEqual([400, 300]);
    const [sx, sy] = toScreen(view, size, 0.2, 0.15);
    expect(sx).toBeCloseTo(600, 9);
    expect(sy).toBeCloseTo(100, 9);
  });

  it("goes from the screen back to the world", () => {
    const [x, y] = toWorld(view, size, ...toScreen(view, size, 0.137, -0.02));
    expect(x).toBeCloseTo(0.137, 12);
    expect(y).toBeCloseTo(-0.02, 12);
  });

  it("moves the world with the pointer when dragged", () => {
    const moved = panned(view, 40, -20);
    expect(toScreen(moved, size, 0.1, 0.05)).toEqual([440, 280]);
  });

  it("zooms about the pointer", () => {
    const before = toWorld(view, size, 650, 120);
    const closer = zoomed(view, size, 650, 120, 1.5);
    expect(closer.scale).toBe(3000);
    const after = toWorld(closer, size, 650, 120);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
  });

  it("does not zoom without end", () => {
    expect(zoomed(view, size, 0, 0, 1e-9).scale).toBe(1);
    expect(zoomed(view, size, 0, 0, 1e9).scale).toBe(1e7);
  });

  it("fits a box with room round it, whichever way it is long", () => {
    const wide = fitted({ minX: 0, maxX: 0.4, minY: 0, maxY: 0.1 }, size, 0.1);
    expect(wide).toEqual({ x: 0.2, y: 0.05, scale: 1600 });
    const tall = fitted({ minX: 0, maxX: 0.1, minY: 0, maxY: 0.4 }, size, 0.1);
    expect(tall.scale).toBeCloseTo(1200, 9);
    // A single point still gives a view.
    expect(Number.isFinite(fitted({ minX: 1, maxX: 1, minY: 2, maxY: 2 }, size).scale)).toBe(true);
  });

  it("says what part of the world is in view", () => {
    const box = visible(view, size);
    expect(box.minX).toBeCloseTo(-0.1, 12);
    expect(box.maxX).toBeCloseTo(0.3, 12);
    expect(box.minY).toBeCloseTo(-0.1, 12);
    expect(box.maxY).toBeCloseTo(0.2, 12);
  });

  it("gives the transform that draws the world in place", () => {
    expect(worldTransform(view, size)).toBe("matrix(2000 0 0 -2000 200 400)");
  });
});

describe("the grid", () => {
  const mm = 0.001;

  it("is a round number of document units, never closer than asked", () => {
    // 2000 px/m: a millimetre is 2 px, so 14 px needs 7 mm, and the next round step is 10.
    expect(gridStep(2000, mm)).toBeCloseTo(0.01, 12);
    expect(gridStep(7000, mm)).toBeCloseTo(0.002, 12);
    expect(gridStep(14000, mm)).toBeCloseTo(0.001, 12);
    expect(gridStep(100, 0.0254)).toBeCloseTo(0.0254 * 10, 12);
  });

  it("follows the zoom", () => {
    for (const scale of [3, 40, 555, 9000, 123456]) {
      const pixels = gridStep(scale, mm) * scale;
      expect(pixels).toBeGreaterThanOrEqual(14 - 1e-9);
      expect(pixels).toBeLessThan(14 * 2.5 + 1e-9);
    }
  });

  it("lies on round positions, every fifth line stronger", () => {
    const lines = gridLines(-0.012, 0.021, 0.005);
    expect(lines.map((line) => Math.round(line.at * 1000))).toEqual([-10, -5, 0, 5, 10, 15, 20]);
    expect(lines.filter((line) => line.major).map((line) => Math.round(line.at * 1000))).toEqual([
      0,
    ]);
    expect(gridLines(0.025, 0.025, 0.005)).toHaveLength(1);
  });
});

describe("a dimension", () => {
  it("writes its value above a line that runs across", () => {
    expect(dimensionGeometry([100, 200], [300, 200], 10)).toEqual({
      x: 200,
      y: 190,
      angle: 0,
      length: 200,
    });
  });

  it("reads the same whichever end is given first", () => {
    const one = dimensionGeometry([100, 200], [300, 100]);
    const other = dimensionGeometry([300, 100], [100, 200]);
    expect(other.angle).toBeCloseTo(one.angle, 12);
    expect(other.x).toBeCloseTo(one.x, 12);
    expect(other.y).toBeCloseTo(one.y, 12);
  });

  it("turns with a line that runs up, to read from below", () => {
    const up = dimensionGeometry([100, 300], [100, 100], 10);
    expect(up.angle).toBe(-90);
    expect(up.x).toBeCloseTo(90, 12);
    expect(up.y).toBeCloseTo(200, 12);
  });
});
