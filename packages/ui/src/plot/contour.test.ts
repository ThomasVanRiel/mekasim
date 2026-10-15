import { describe, expect, it } from "vitest";
import { contour, defaultWidth, type PassField, type PassSample, passField } from "./contour.ts";

/** Runs spread evenly over the unit square, the same each time. */
function spread(count: number, passes: (x: number, y: number) => boolean): PassSample[] {
  return Array.from({ length: count }, (_, i) => {
    const x = (0.5 + i * 0.7548776662466927) % 1;
    const y = (0.5 + i * 0.5698402909980532) % 1;
    return { x, y, passed: passes(x, y) };
  });
}

const UNIT: [number, number] = [0, 1];

describe("the share passed over a study's scatter", () => {
  it("is the plain share passed when every run reaches everywhere", () => {
    const samples = spread(200, (x) => x < 0.3);
    const field = passField(samples, UNIT, UNIT, { cells: 5, width: 1000 });
    const plain = samples.filter(({ passed }) => passed).length / samples.length;
    for (const share of field.share) expect(share).toBeCloseTo(plain, 6);
    for (const weight of field.weight) expect(weight).toBeCloseTo(200, 3);
  });

  it("reaches less far the more runs there are", () => {
    expect(defaultWidth(500)).toBeCloseTo(0.102, 3);
    expect(defaultWidth(2000)).toBeLessThan(defaultWidth(100));
  });

  it("finds the edge of a round region that passes as one closed line", () => {
    const samples = spread(2000, (x, y) => Math.hypot(x - 0.5, y - 0.5) < 0.3);
    const lines = contour(passField(samples, UNIT, UNIT), 0.5);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line[0]).toEqual(line[line.length - 1]);
    for (const [x, y] of line)
      expect(Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.3)).toBeLessThan(0.03);
  });

  it("finds a straight edge as one open line from side to side", () => {
    const samples = spread(1000, (x) => x > 0.6);
    const lines = contour(passField(samples, UNIT, UNIT), 0.5);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const [x] of line) expect(Math.abs(x - 0.6)).toBeLessThan(0.03);
    const ys = line.map(([, y]) => y).sort((p, q) => p - q);
    expect(ys[0]).toBe(0);
    expect(ys[ys.length - 1]).toBe(1);
  });

  it("works in the axes' own values", () => {
    const samples = spread(1000, (x) => x > 0.6).map(({ x, y, passed }) => ({
      x: 85 * x,
      y: -8 + 10 * y,
      passed,
    }));
    const [line] = contour(passField(samples, [0, 85], [-8, 2]), 0.5);
    for (const [x, y] of line) {
      expect(Math.abs(x - 51)).toBeLessThan(2.5);
      expect(y).toBeGreaterThanOrEqual(-8);
      expect(y).toBeLessThanOrEqual(2);
    }
  });

  it("draws no line where too few runs lie", () => {
    // Runs only on the left; the edge between them runs across the whole square.
    const samples = spread(2000, (_, y) => y > 0.5).filter(({ x }) => x < 0.4);
    const field = passField(samples, UNIT, UNIT);
    const all = contour(field, 0.5).flat();
    const sure = contour(field, 0.5, 5).flat();
    expect(Math.max(...all.map(([x]) => x))).toBeGreaterThan(0.6);
    expect(sure.length).toBeGreaterThan(0);
    expect(Math.max(...sure.map(([x]) => x))).toBeLessThan(0.55);
    for (const [, y] of sure) expect(Math.abs(y - 0.5)).toBeLessThan(0.03);
  });

  it("parts a saddle by the share in its middle", () => {
    const field = (share: number[]): PassField => ({
      xs: [0, 1],
      ys: [0, 1],
      share: Float64Array.from(share),
      weight: Float64Array.from([1, 1, 1, 1]),
    });
    const corners = (lines: ReturnType<typeof contour>) =>
      lines
        .map((line) => line.map(([x, y]) => `${x},${y}`).sort())
        .map((line) => line.join(" "))
        .sort();
    // Low-left and high-right passed. A middle above the level joins them, cutting off
    // the other two corners; a middle below it cuts off these two.
    expect(corners(contour(field([1, 0, 0, 1]), 0.4))).toEqual(["0,0.6 0.4,1", "0.6,0 1,0.4"]);
    expect(corners(contour(field([1, 0, 0, 1]), 0.6))).toEqual(["0,0.4 0.4,0", "0.6,1 1,0.6"]);
  });
});
