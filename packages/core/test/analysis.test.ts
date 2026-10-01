import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/analysis/csv.ts";
import { sweep } from "../src/analysis/sweep.ts";
import { addMeasure, addPlot, editText } from "../src/edit/operations.ts";
import { load } from "../src/schema/load.ts";
import { simulate } from "../src/simulate.ts";

const shaker = readFileSync(
  new URL("../../../examples/shaker.mekasim.yaml", import.meta.url),
  "utf8",
);

const PLOTS = `
measures:
  gap: dist(upper_deck.F, lower_deck.F)
  gap_swing: range(gap)
plots:
  decks: [x(upper_deck.F), x(lower_deck.F), gap]
  speed: v(upper_deck.F)
`;

function withPlots(): string {
  // The example ends with its own measures; replace that section.
  return shaker.slice(0, shaker.indexOf("measures:")) + PLOTS.trimStart();
}

describe("plots", () => {
  const simulation = simulate(withPlots());

  it("evaluates each series of each plot over the cycle", () => {
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.plots.map((p) => [p.id, p.series.map((s) => s.source)])).toEqual([
      ["decks", ["x(upper_deck.F)", "x(lower_deck.F)", "gap"]],
      ["speed", ["v(upper_deck.F)"]],
    ]);
    for (const plot of simulation.plots) {
      for (const series of plot.series) expect(series.quantity?.value).toHaveLength(360);
    }
  });

  it("lets measures and plots use earlier measures by name", () => {
    const gap = simulation.measures.find((m) => m.id === "gap")?.quantity?.value as Float64Array;
    const swing = simulation.measures.find((m) => m.id === "gap_swing")?.quantity?.value;
    expect(swing).toBeCloseTo(Math.max(...gap) - Math.min(...gap), 12);
    expect(simulation.plots[0]?.series[2]?.quantity?.value).toEqual(gap);
  });

  it("reports a mistake in a series on its own line", () => {
    const broken = simulate(withPlots().replace("x(lower_deck.F), gap]", "x(lower_deck.Q), gap]"));
    const [error] = broken.diagnostics.filter((d) => d.severity === "error");
    expect(error?.message).toBe('Body "lower_deck" has no point "Q"');
    expect(error?.path).toEqual(["plots", "decks", 1]);
  });
});

describe("toCsv", () => {
  const lines = toCsv(simulate(withPlots())).trimEnd().split("\n");

  it("has a column for time, the driver angle, traces, signal measures and plot series", () => {
    expect(lines[0]).toBe(
      [
        "t [s]",
        "motor angle [deg]",
        "upper_deck.F.x [mm]",
        "upper_deck.F.y [mm]",
        "lower_deck.F.x [mm]",
        "lower_deck.F.y [mm]",
        "gap [mm]",
        "x(upper_deck.F) [mm]",
        "x(lower_deck.F) [mm]",
        "v(upper_deck.F) [mm/s]",
      ].join(","),
    );
  });

  it("has one row per sample, in document units", () => {
    expect(lines).toHaveLength(361);
    expect(lines[1]?.split(",").slice(0, 4)).toEqual(["0", "0", "500", "120"]);
    expect(lines[91]?.split(",")[1]).toBe("90");
  });

  it("quotes a header that contains a comma", () => {
    const csv = toCsv(simulate(`${withPlots()}  far: dist(ground.O, upper_deck.B)\n`));
    expect(csv.split("\n")[0]).toContain('"dist(ground.O, upper_deck.B) [mm]"');
  });
});

describe("sweep", () => {
  it("solves the model for each value of a parameter", () => {
    const runs = sweep(shaker, "ecc", [10, 15, 20], "mm");
    expect(runs.map((r) => r.value)).toEqual(["10 mm", "15 mm", "20 mm"]);
    const strokes = runs.map(
      (r) => r.simulation.measures.find((m) => m.id === "upper_stroke")?.quantity?.value as number,
    );
    // A larger eccentric gives a longer stroke, roughly in proportion.
    expect(strokes[1]).toBeCloseTo(0.0602412, 6);
    expect((strokes[2] as number) / (strokes[0] as number)).toBeGreaterThan(1.9);
    expect((strokes[2] as number) / (strokes[0] as number)).toBeLessThan(2.1);
  });

  it("leaves the model text alone", () => {
    const before = shaker;
    sweep(shaker, "ecc", [1, 2], "mm");
    expect(shaker).toBe(before);
  });
});

describe("adding measures and plots", () => {
  it("writes them into their sections under free names", () => {
    let text = shaker;
    const read = () => load(text).doc as NonNullable<ReturnType<typeof load>["doc"]>;
    text = editText(text, addMeasure(read(), "dist", "dist(ground.O, upper_deck.B)").edits);
    text = editText(
      text,
      addPlot(read(), "deck_position", ["x(upper_deck.F)", "y(upper_deck.F)"]).edits,
    );
    text = editText(text, addPlot(read(), "deck_position", ["dist1"]).edits);
    expect(text).toContain(
      "  upper_peak_g: max(a(upper_deck.F)) / g\n  dist1: dist(ground.O, upper_deck.B)\n",
    );
    expect(
      text.endsWith(
        "  upper_accel: a(upper_deck.F)\n  deck_position: [x(upper_deck.F), y(upper_deck.F)]\n  deck_position_1: [dist1]\n",
      ),
    ).toBe(true);
    expect(simulate(text).diagnostics).toEqual([]);
  });
});
