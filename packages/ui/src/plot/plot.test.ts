import { readFileSync } from "node:fs";
import { simulate, sweep } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { buildCharts, buildSweepCharts, SERIES_COLORS, SWEEP_COLORS } from "./charts.ts";
import {
  extentOf,
  extentScale,
  formatNumber,
  linePath,
  mapper,
  nearestIndex,
  spread,
  valueScale,
} from "./geometry.ts";

describe("valueScale", () => {
  it("widens to round numbers and ticks on them", () => {
    expect(valueScale(469.9, 530.1)).toEqual({
      min: 460,
      max: 540,
      ticks: [460, 480, 500, 520, 540],
    });
    expect(valueScale(-0.3, 4.6).ticks).toEqual([-2, 0, 2, 4, 6]);
  });

  it("gives a constant room on both sides", () => {
    const scale = valueScale(120, 120);
    expect(scale.min).toBeLessThan(120);
    expect(scale.max).toBeGreaterThan(120);
    expect(valueScale(0, 0)).toMatchObject({ min: -1, max: 1 });
  });

  it("has no rounding dust in its ticks", () => {
    expect(valueScale(0, 0.3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe("extentScale", () => {
  it("keeps the extent of the data and ticks inside it", () => {
    expect(extentScale(0, 0.214, 4)).toEqual({ min: 0, max: 0.214, ticks: [0, 0.1, 0.2] });
  });

  it("divides a turn in degrees evenly", () => {
    expect(extentScale(0, 359, 8, true).ticks).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(extentScale(0, 719, 8, true).ticks).toEqual([0, 90, 180, 270, 360, 450, 540, 630]);
  });

  it("runs from the first value to the last, also when the values fall", () => {
    // A driver turning clockwise: its angle goes from 0 down to -359.
    const scale = extentScale(0, -359, 8, true);
    expect(scale).toEqual({
      min: 0,
      max: -359,
      ticks: [0, -45, -90, -135, -180, -225, -270, -315],
    });
    const x = mapper(scale, 100, 500);
    expect(x(0)).toBe(100);
    expect(x(-359)).toBe(500);
    expect(x(-90)).toBeLessThan(x(-180));
    expect(extentScale(5, 5)).toEqual({ min: 5, max: 6, ticks: [5] });
  });
});

describe("drawing helpers", () => {
  it("maps values to pixels, upside down for a vertical axis", () => {
    const y = mapper({ min: 0, max: 10, ticks: [] }, 100, 0);
    expect(y(0)).toBe(100);
    expect(y(10)).toBe(0);
    expect(y(2.5)).toBe(75);
  });

  it("writes a path and skips values that are not numbers", () => {
    const identity = (v: number) => v;
    expect(linePath([0, 1, 2, 3], [5, Number.NaN, 7, 8.04], identity, identity)).toBe(
      "M0.0 5.0L2.0 7.0L3.0 8.0",
    );
  });

  it("moves crowded labels apart, in order and within bounds", () => {
    expect(spread([10, 12, 50], 10, 0, 100)).toEqual([10, 20, 50]);
    expect(spread([95, 97, 99], 10, 0, 100)).toEqual([80, 90, 100]);
    // Given out of order, each keeps its own slot.
    expect(spread([50, 10, 12], 10, 0, 100)).toEqual([50, 10, 20]);
  });

  it("finds the sample nearest a position", () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 99)).toBe(3);
  });

  it("finds the least and greatest of a line, where they fall, and their difference", () => {
    expect(extentOf([3, -2, 7, 7, 1])).toEqual({
      min: -2,
      max: 7,
      range: 9,
      minIndex: 1,
      maxIndex: 2,
    });
    expect(extentOf([5, Number.NaN, 5])).toMatchObject({ min: 5, max: 5, range: 0 });
    expect(extentOf([])).toBeUndefined();
  });

  it("formats numbers briefly", () => {
    expect(formatNumber(60.24123456)).toBe("60.241");
    expect(formatNumber(-0.0000001, 3)).toBe("-1e-7");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe("–");
  });
});

const shaker = readFileSync(
  new URL("../../../../examples/shaker.mekasim.yaml", import.meta.url),
  "utf8",
);
// The example has plots of its own; these replace them.
const model = `${shaker.slice(0, shaker.indexOf("plots:"))}plots:
  deck: [x(upper_deck.F), y(upper_deck.F), v(upper_deck.F), upper_stroke]
  swing: angle(rocker)
`;

describe("buildCharts", () => {
  const charts = buildCharts(simulate(model));

  // A measure plotted by its name is shown as words; an expression is left as written.
  it("makes one chart per unit of a plot, never two scales on one chart", () => {
    expect(charts.map((c) => [c.title, c.unit, c.lines.map((l) => l.label)])).toEqual([
      ["Deck", "mm", ["x(upper_deck.F)", "y(upper_deck.F)", "Upper stroke"]],
      ["Deck", "mm/s", ["v(upper_deck.F)"]],
      ["Swing", "deg", ["angle(rocker)"]],
    ]);
  });

  it("shows a kind of quantity in the unit an app gives for it, and the rest as before", () => {
    // Lengths in centimetres, as an app might ask; angles are left to the document.
    const inCm = buildCharts(simulate(model), (dim) =>
      dim[0] === 1 && dim[1] === 0 && dim[2] === 0 && dim[3] === 0
        ? { label: "cm", factor: 0.01 }
        : undefined,
    );
    expect(inCm.map((c) => c.unit)).toEqual(charts.map((c) => (c.unit === "mm" ? "cm" : c.unit)));
    const before = charts.find((c) => c.unit === "mm")?.lines[0]?.values[3] as number;
    expect(inCm.find((c) => c.unit === "cm")?.lines[0]?.values[3]).toBeCloseTo(before / 10, 12);
  });

  it("gives each series of a plot its own colour, kept across the split", () => {
    expect(charts[0]?.lines.map((l) => l.color)).toEqual([
      SERIES_COLORS[0],
      SERIES_COLORS[1],
      SERIES_COLORS[3],
    ]);
    expect(charts[1]?.lines[0]?.color).toBe(SERIES_COLORS[2]);
  });

  it("plots against the driver angle in document units", () => {
    expect(charts[0]?.x).toMatchObject({ label: "Motor angle", unit: "deg" });
    expect(charts[0]?.x.values[90]).toBeCloseTo(90, 9);
    expect(charts[0]?.lines[0]?.values[0]).toBeCloseTo(500, 9);
  });

  it("draws a single number as a level line", () => {
    const stroke = charts[0]?.lines[2]?.values as Float64Array;
    expect(stroke).toHaveLength(360);
    expect(stroke[0]).toBeCloseTo(60.2412, 3);
    expect(stroke[359]).toBe(stroke[0]);
  });

  it("charts the traced points and varying measures of a model that asks for no plots", () => {
    const text = shaker.slice(0, shaker.indexOf("plots:"));
    const bare = simulate(`${text.trimEnd()}\n  gap: dist(upper_deck.F, lower_deck.F)\n`);
    expect(bare.diagnostics).toEqual([]);
    expect(buildCharts(bare).map((c) => [c.title, c.lines.map((l) => l.label)])).toEqual([
      ["Upper deck F", ["x(upper_deck.F)", "y(upper_deck.F)"]],
      ["Lower deck F", ["x(lower_deck.F)", "y(lower_deck.F)"]],
      ["Gap", ["Gap"]],
    ]);
    const swept = buildSweepCharts("ecc", sweep(text, "ecc", [10, 20], "mm"));
    expect(swept.map((c) => c.title)).toEqual([
      "Upper deck F: x(upper_deck.F)",
      "Upper deck F: y(upper_deck.F)",
      "Lower deck F: x(lower_deck.F)",
      "Lower deck F: y(lower_deck.F)",
    ]);
  });

  it("has nothing to chart for a model that does not move", () => {
    expect(buildCharts(simulate(model.replace(/drivers:\n.*\n/, "")))).toEqual([]);
  });
});

describe("buildSweepCharts", () => {
  const charts = buildSweepCharts("ecc", sweep(model, "ecc", [10, 15, 20], "mm"));

  it("makes one chart per series with a line per value, light to dark", () => {
    expect(charts.map((c) => c.title)).toEqual([
      "Deck: x(upper_deck.F)",
      "Deck: y(upper_deck.F)",
      "Deck: v(upper_deck.F)",
      "Deck: Upper stroke",
      "Swing",
    ]);
    expect(charts[0]?.lines.map((l) => [l.label, l.color])).toEqual([
      ["Ecc = 10 mm", SWEEP_COLORS[0]],
      ["Ecc = 15 mm", SWEEP_COLORS[1]],
      ["Ecc = 20 mm", SWEEP_COLORS[2]],
    ]);
  });

  it("shows the effect of the parameter", () => {
    const peak = (line: number) => Math.max(...(charts[2]?.lines[line]?.values ?? []));
    expect(peak(2)).toBeGreaterThan(peak(0) * 1.8);
  });
});
