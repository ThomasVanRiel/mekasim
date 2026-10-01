import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/analysis/csv.ts";
import { sweep } from "../src/analysis/sweep.ts";
import { addMeasure, addPlot, editText, nameMeasure } from "../src/edit/operations.ts";
import type { Quantity } from "../src/expr/evaluate.ts";
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

  it("plots the jerk of a point, the rate at which its acceleration changes", () => {
    const jerky = simulate(
      `${withPlots()}  jerk: [j(upper_deck.F), jx(upper_deck.F), a(upper_deck.F)]\n`,
    );
    expect(jerky.diagnostics).toEqual([]);
    const { cycle } = jerky;
    const [j, jx, a] = (jerky.plots[2]?.series ?? []).map((s) => s.quantity) as Quantity[];
    expect(j?.dim).toEqual([1, -3, 0, 0]);
    expect(toCsv(jerky).split("\n")[0]).toContain("j(upper_deck.F) [mm/s³]");
    // The deck only moves sideways, so its acceleration along x changes at the rate jx.
    const signed = simulate(`${withPlots()}  ax: ax(upper_deck.F)\n`).plots[2]?.series[0]?.quantity
      ?.value as Float64Array;
    const dt = (cycle?.t[1] ?? 0) - (cycle?.t[0] ?? 0);
    const n = signed.length;
    const peak = Math.max(...(j.value as Float64Array));
    expect(peak).toBeGreaterThan(0);
    expect(Math.max(...(a.value as Float64Array))).toBeGreaterThan(0);
    for (let k = 0; k < n; k++) {
      const numeric = (signed[(k + 1) % n] - signed[(k - 1 + n) % n]) / (2 * dt);
      expect(Math.abs((jx.value as Float64Array)[k] - numeric)).toBeLessThan(2e-3 * peak);
    }
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

describe("measuring a link as a whole", () => {
  const text = `${shaker.slice(0, shaker.indexOf("measures:"))}measures:
  centre_x: x(upper_deck)
  centre_y: y(upper_deck)
  ends_x: (x(upper_deck.F) + x(upper_deck.B)) / 2
  centre_speed: v(upper_deck)
  end_speed: v(upper_deck.F)
  apart: dist(upper_deck, lower_deck)
  rocker_centre: y(rocker)
`;
  const simulation = simulate(text);
  const signal = (id: string) =>
    simulation.measures.find((m) => m.id === id)?.quantity?.value as Float64Array;

  it("takes the position of a link to be the middle of its points", () => {
    expect(simulation.diagnostics).toEqual([]);
    for (let k = 0; k < 360; k += 30) {
      expect(signal("centre_x")[k]).toBeCloseTo(signal("ends_x")[k] as number, 12);
    }
    // The deck's two points start at (500, 120) and (1300, 120).
    expect(signal("centre_x")[0]).toBeCloseTo(0.9, 9);
    expect(signal("centre_y")[0]).toBeCloseTo(0.12, 9);
  });

  it("measures how far a point or a link is from where it started", () => {
    const moved = simulate(
      `${text}  far: moved(upper_deck.F)\n  dx: change(x(upper_deck.F))\n  dy: change(y(upper_deck.F))\n  whole: moved(upper_deck)\n`,
    );
    const of = (id: string) =>
      moved.measures.find((m) => m.id === id)?.quantity?.value as Float64Array;
    expect(moved.diagnostics).toEqual([]);
    expect(of("far")[0]).toBe(0);
    for (let k = 0; k < 360; k += 30) {
      expect(of("far")[k]).toBeCloseTo(
        Math.hypot(of("dx")[k] as number, of("dy")[k] as number),
        12,
      );
      // Every point of the deck moves alike, so its centre has moved as far as its end.
      expect(of("whole")[k]).toBeCloseTo(of("far")[k] as number, 9);
    }
    expect(Math.max(...of("far"))).toBeGreaterThan(0.03);
  });

  it("gives speeds and distances of links the same way", () => {
    // The deck hangs on equal parallel arms, so every point of it moves alike.
    for (let k = 0; k < 360; k += 30) {
      expect(signal("centre_speed")[k]).toBeCloseTo(signal("end_speed")[k] as number, 9);
    }
    // The decks start 240 mm apart, one above the other.
    expect(signal("apart")[0]).toBeCloseTo(0.24, 9);
    // The rocker's four points average to 15 mm above its pivot when it stands upright.
    expect(signal("rocker_centre")[0]).toBeCloseTo(0.015, 9);
  });
});

describe("naming a measure", () => {
  it("takes the name asked for, numbers it when taken, and skips what is already measured", () => {
    const read = (t: string) => load(t).doc as NonNullable<ReturnType<typeof load>["doc"]>;
    let model = shaker;
    model = editText(model, nameMeasure(read(model), "deck_x", "x(upper_deck)"));
    expect(model).toContain("  deck_x: x(upper_deck)\n");
    expect(nameMeasure(read(model), "other", "x(upper_deck)")).toEqual([]);
    model = editText(model, nameMeasure(read(model), "deck_x", "x(lower_deck)"));
    expect(model).toContain("  deck_x_1: x(lower_deck)\n");
  });
});
