import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Quantity } from "../src/expr/evaluate.ts";
import { type Simulation, simulate } from "../src/simulate.ts";

function example(name: string): Simulation {
  return simulate(
    readFileSync(new URL(`../../../examples/${name}.mekasim.yaml`, import.meta.url), "utf8"),
  );
}

function measure(simulation: Simulation, id: string): number {
  const quantity = simulation.measures.find((m) => m.id === id)?.quantity as Quantity;
  return quantity.value as number;
}

function signal(simulation: Simulation, id: string): Float64Array {
  const quantity = simulation.measures.find((m) => m.id === id)?.quantity as Quantity;
  return quantity.value as Float64Array;
}

/** The turning points of a signal that repeats every cycle, as [step, value]. */
function turningPoints(values: Float64Array): [number, number][] {
  const n = values.length;
  const at = (k: number): number => values[(k + n) % n] as number;
  const points: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const rising = at(k) > at(k - 1);
    const falling = at(k) > at(k + 1);
    if (rising === falling) points.push([k, at(k)]);
  }
  return points;
}

/** Solves through the whole cycle as a mechanism with one degree of freedom, driven. */
function expectRuns(simulation: Simulation, redundant = 0, steps = 360): void {
  expect(simulation.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  expect(simulation.cycle?.count).toBe(steps);
  expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0, redundant });
}

describe("strandbeest legs", () => {
  const legs = example("strandbeest");

  it("runs as one mechanism of thirteen bodies", () => {
    expectRuns(legs);
    expect(legs.mobility).toMatchObject({ coordinates: 39 });
  });

  it("keeps a foot level on the ground for a good part of the turn", () => {
    const lift = signal(legs, "left_lift");
    const standing = Array.from(lift).filter((y) => y < 0.0005).length;
    expect(standing).toBeGreaterThan(120);
    expect(measure(legs, "stride")).toBeCloseTo(0.0679, 3);
    expect(measure(legs, "step_height")).toBeCloseTo(0.0225, 3);
  });

  it("always has a foot within a few millimetres of the ground", () => {
    const left = signal(legs, "left_lift");
    const right = signal(legs, "right_lift");
    for (let k = 0; k < left.length; k++) {
      expect(Math.min(left[k] as number, right[k] as number)).toBeLessThan(0.003);
    }
  });
});

describe("Klann leg", () => {
  const leg = example("klann");

  it("steps a unit long and half a unit high, as in the patent", () => {
    expectRuns(leg);
    expect(measure(leg, "stride")).toBeCloseTo(0.1, 2);
    expect(measure(leg, "step_height")).toBeGreaterThan(0.05);
  });
});

describe("Klann walker", () => {
  const walker = example("klann-walker");

  it("turns both cranks the same way through the pinion", () => {
    expectRuns(walker);
    expect(walker.mobility).toMatchObject({ coordinates: 33 });
    expect(measure(walker, "crank_speed")).toBeCloseTo(-Math.PI, 9);
    expect(measure(walker, "stride")).toBeCloseTo(measure(example("klann"), "stride"), 9);
  });

  it("puts one foot down as the other lifts", () => {
    const left = signal(walker, "left_lift");
    const right = signal(walker, "right_lift");
    for (let k = 0; k < left.length; k++) {
      // The right leg is the left one mirrored, so it goes through the left leg's
      // motion backwards.
      expect(right[(360 - k) % 360]).toBeCloseTo(left[k] as number, 9);
      expect(Math.min(left[k] as number, right[k] as number)).toBeLessThan(0.006);
    }
  });
});

describe("Hoecken straight line", () => {
  const linkage = example("hoecken");

  it("keeps the point within half a millimetre of a line for half a turn", () => {
    expectRuns(linkage);
    const rise = signal(linkage, "rise");
    // The crank starts in the middle of the straight part.
    for (let k = -90; k <= 90; k++) expect(rise[(k + 360) % 360]).toBeLessThan(0.0005);
    expect(measure(linkage, "height")).toBeGreaterThan(0.03);
  });
});

describe("Peaucellier straight line", () => {
  const linkage = example("peaucellier");

  it("draws an exactly straight line", () => {
    expectRuns(linkage);
    expect(measure(linkage, "stroke")).toBeGreaterThan(0.1);
    expect(measure(linkage, "wander")).toBeLessThan(1e-9);
    expect(measure(linkage, "product_change")).toBeLessThan(1e-9);
  });
});

describe("beam engine", () => {
  const engine = example("beam-engine");

  it("guides the piston rod far straighter than the end of the beam moves", () => {
    expectRuns(engine);
    expect(measure(engine, "stroke")).toBeCloseTo(0.18, 2);
    expect(measure(engine, "wander")).toBeLessThan(0.001);
    expect(measure(engine, "beam_end_wander")).toBeGreaterThan(0.01);
    // The parallelogram copies the motion of the back link's middle at twice the size.
    expect(measure(engine, "wander") / measure(engine, "pump_wander")).toBeCloseTo(2, 6);
  });
});

describe("scotch yoke", () => {
  const yoke = example("scotch-yoke");
  const r = 0.03;
  const rod = 0.09;
  const w = (120 * 2 * Math.PI) / 60;

  it("moves the yoke as a pure sine and the piston as a slider-crank", () => {
    expectRuns(yoke);
    expect(measure(yoke, "yoke_stroke")).toBeCloseTo(2 * r, 12);
    expect(measure(yoke, "piston_stroke")).toBeCloseTo(2 * r, 12);
    expect(measure(yoke, "yoke_peak_accel")).toBeCloseTo(r * w * w, 6);
    expect(measure(yoke, "piston_peak_accel")).toBeCloseTo(r * w * w * (1 + r / rod), 6);
    expect(measure(yoke, "rod_effect")).toBeCloseTo(rod - Math.sqrt(rod * rod - r * r), 9);
  });
});

describe("Whitworth quick return", () => {
  const shaper = example("quick-return");

  it("cuts over two thirds of a turn and returns in one third", () => {
    expectRuns(shaper);
    expect(measure(shaper, "stroke")).toBeCloseTo(0.1, 9);
    const ram = shaper.plots.find((p) => p.id === "ram")?.series[0]?.quantity
      ?.value as Float64Array;
    const ends = turningPoints(ram).map(([k]) => k);
    expect(ends).toHaveLength(2);
    // The crank starts at 90 degrees; the ram turns round at 210 and at 330.
    expect(ends).toEqual([120, 240]);
    expect(measure(shaper, "quickness")).toBeGreaterThan(2);
  });
});

describe("pumpjack", () => {
  const pump = example("pumpjack");

  it("nods through about twice the crank radius times the beam's ratio", () => {
    expectRuns(pump);
    expect(measure(pump, "stroke")).toBeCloseTo(0.21, 2);
    expect(measure(pump, "beam_swing")).toBeCloseTo((41 * Math.PI) / 180, 2);
  });
});

describe("straw walkers", () => {
  const walkers = example("straw-walker");

  it("carries each trough round a circle without tilting it", () => {
    // Each trough after the first holds the rear shaft where the others already do.
    expectRuns(walkers, 2);
    const w = (200 * 2 * Math.PI) / 60;
    expect(measure(walkers, "toss")).toBeCloseTo(0.1, 9);
    expect(measure(walkers, "tilt")).toBeLessThan(1e-9);
    expect(measure(walkers, "peak_g")).toBeCloseTo((0.05 * w * w) / 9.80665, 6);
  });
});

describe("Cardan straight line", () => {
  const couple = example("cardan");

  it("moves the point along a line four arms long", () => {
    expectRuns(couple);
    expect(measure(couple, "stroke")).toBeCloseTo(0.4, 9);
    expect(measure(couple, "wander")).toBeLessThan(1e-9);
  });

  it("draws an ellipse for any other reach", () => {
    const text = readFileSync(
      new URL("../../../examples/cardan.mekasim.yaml", import.meta.url),
      "utf8",
    );
    const ellipse = simulate(text.replace("reach: arm ", "reach: 40 mm "));
    expect(measure(ellipse, "stroke")).toBeCloseTo(0.28, 9);
    expect(measure(ellipse, "wander")).toBeCloseTo(0.12, 9);
  });
});

describe("Atkinson engine", () => {
  const engine = example("atkinson");

  it("makes four strokes of different lengths in one turn", () => {
    expectRuns(engine);
    const points = turningPoints(signal(engine, "height"));
    expect(points).toHaveLength(4);
    const [exhaustTop, intakeBottom, compressionTop, expansionBottom] = points.map(
      ([, y]) => y,
    ) as [number, number, number, number];
    const intake = exhaustTop - intakeBottom;
    const compression = compressionTop - intakeBottom;
    const expansion = compressionTop - expansionBottom;
    const exhaust = exhaustTop - expansionBottom;
    expect(intake).toBeCloseTo(0.0335, 3);
    expect(compression).toBeCloseTo(0.027, 3);
    expect(expansion).toBeCloseTo(0.0623, 3);
    expect(exhaust).toBeCloseTo(0.0688, 3);
    expect(exhaust).toBeCloseTo(measure(engine, "longest_stroke"), 12);
  });
});

describe("four-stroke engine", () => {
  const engine = example("four-stroke");
  const piston = signal(engine, "piston_down");
  const inlet = signal(engine, "inlet_open");
  const exhaust = signal(engine, "exhaust_open");
  /** The step at a crank angle: 720 steps over two turns is one to the degree. */
  const at = (degrees: number): number => degrees % 720;

  it("turns the camshafts once for two turns of the crank", () => {
    expectRuns(engine, 0, 720);
    expect(measure(engine, "stroke")).toBeCloseTo(0.08, 12);
    expect(measure(engine, "camshaft_speed")).toBeCloseTo(-2 * Math.PI, 9);
    expect(turningPoints(piston)).toHaveLength(4);
  });

  it("lifts each valve once, the inlet on the way down and the exhaust on the way up", () => {
    expect(Math.max(...inlet)).toBeCloseTo(0.008, 9);
    expect(Math.max(...exhaust)).toBeCloseTo(0.008, 9);
    // The inlet is open from 10 before the top to 50 after the bottom: fully at 110.
    expect(inlet[at(110)]).toBeCloseTo(0.008, 9);
    expect(inlet[at(700)]).toBeLessThan(1e-9);
    expect(inlet[at(240)]).toBeLessThan(1e-9);
    // The exhaust is open from 50 before the bottom to 10 after the top: fully at 610.
    expect(exhaust[at(610)]).toBeCloseTo(0.008, 9);
    expect(exhaust[at(480)]).toBeLessThan(1e-9);
    expect(exhaust[at(20)]).toBeLessThan(1e-9);
  });

  it("keeps both valves shut through compression and power", () => {
    for (let degrees = 240; degrees <= 480; degrees++) {
      expect(inlet[at(degrees)]).toBeLessThan(1e-9);
      expect(exhaust[at(degrees)]).toBeLessThan(1e-9);
    }
    expect(measure(engine, "overlap")).toBeGreaterThan(0);
    expect(measure(engine, "overlap")).toBeLessThan(0.0001);
  });
});
