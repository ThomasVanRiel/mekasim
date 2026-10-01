import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pointMotion } from "../src/analysis/measures.ts";
import type { Quantity } from "../src/expr/evaluate.ts";
import { type Simulation, simulate } from "../src/simulate.ts";

function example(name: string): Simulation {
  const text = readFileSync(
    new URL(`../../../examples/${name}.mekasim.yaml`, import.meta.url),
    "utf8",
  );
  const simulation = simulate(text);
  expect(simulation.diagnostics).toEqual([]);
  return simulation;
}

function measure(simulation: Simulation, id: string): number {
  const quantity = simulation.measures.find((m) => m.id === id)?.quantity as Quantity;
  return quantity.value as number;
}

/** Central difference of a signal that repeats every cycle. */
function derivative(signal: Float64Array, dt: number): Float64Array {
  const n = signal.length;
  return signal.map((_, k) => (signal[(k + 1) % n] - signal[(k - 1 + n) % n]) / (2 * dt));
}

function expectSignalsClose(actual: Float64Array, expected: Float64Array, relative: number): void {
  const scale = expected.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  for (let k = 0; k < expected.length; k++) {
    expect(Math.abs(actual[k] - expected[k])).toBeLessThan(relative * scale);
  }
}

describe("slider-crank", () => {
  const simulation = example("slider-crank");
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) throw new Error("not solved");
  const r = 0.015;
  const l = 0.42;
  const w = (300 * 2 * Math.PI) / 60;
  const slider = pointMotion(compiled, cycle, "rod.B");

  it("solves the whole cycle", () => {
    expect(cycle.count).toBe(360);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0, redundant: 0 });
  });

  it("matches the closed-form position, velocity and acceleration", () => {
    for (let k = 0; k < cycle.count; k++) {
      const a = w * cycle.t[k];
      const root = Math.sqrt(l * l - (r * Math.sin(a)) ** 2);
      const x = r * Math.cos(a) + root;
      const dx = -r * Math.sin(a) - (r * r * Math.sin(a) * Math.cos(a)) / root;
      const ddx =
        -r * Math.cos(a) -
        (r * r * Math.cos(2 * a)) / root -
        (r ** 4 * (Math.sin(a) * Math.cos(a)) ** 2) / root ** 3;
      expect(slider.x[k]).toBeCloseTo(x, 10);
      expect(slider.y[k]).toBeCloseTo(0, 10);
      expect(slider.vx[k]).toBeCloseTo(w * dx, 8);
      expect(slider.ax[k]).toBeCloseTo(w * w * ddx, 6);
    }
  });

  it("reports the stroke as twice the crank radius", () => {
    expect(measure(simulation, "stroke")).toBeCloseTo(2 * r, 10);
    expect(measure(simulation, "rod_swing")).toBeCloseTo(2 * Math.asin(r / l), 10);
  });
});

describe("four-bar", () => {
  const simulation = example("four-bar");
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) throw new Error("not solved");
  const crank = 0.04;
  const coupler = 0.16;
  const rocker = 0.11;
  const ground = 0.18;
  const w = (300 * 2 * Math.PI) / 60;

  /** Coupler-rocker pin from intersecting two circles, on the open branch. */
  function pinB(angle: number): [number, number] {
    const ax = crank * Math.cos(angle);
    const ay = crank * Math.sin(angle);
    const d = Math.hypot(ground - ax, -ay);
    const ex = (ground - ax) / d;
    const ey = -ay / d;
    const along = (coupler ** 2 - rocker ** 2 + d ** 2) / (2 * d);
    const across = Math.sqrt(coupler ** 2 - along ** 2);
    return [ax + along * ex - across * ey, ay + along * ey + across * ex];
  }

  it("matches the closed-form position over the whole cycle", () => {
    expect(cycle.count).toBe(360);
    const b = pointMotion(compiled, cycle, "coupler.B");
    for (let k = 0; k < cycle.count; k++) {
      const [x, y] = pinB(w * cycle.t[k]);
      expect(b.x[k]).toBeCloseTo(x, 10);
      expect(b.y[k]).toBeCloseTo(y, 10);
    }
  });

  it("keeps every link at its length", () => {
    const a = pointMotion(compiled, cycle, "crank.A");
    const b = pointMotion(compiled, cycle, "rocker.B");
    const p = pointMotion(compiled, cycle, "coupler.P");
    for (let k = 0; k < cycle.count; k++) {
      expect(Math.hypot(a.x[k], a.y[k])).toBeCloseTo(crank, 10);
      expect(Math.hypot(b.x[k] - a.x[k], b.y[k] - a.y[k])).toBeCloseTo(coupler, 10);
      expect(Math.hypot(b.x[k] - ground, b.y[k])).toBeCloseTo(rocker, 10);
      expect(Math.hypot(p.x[k] - a.x[k], p.y[k] - a.y[k])).toBeCloseTo(0.1, 10);
    }
  });

  it("has velocities and accelerations consistent with the positions", () => {
    const dt = cycle.t[1] - cycle.t[0];
    const p = pointMotion(compiled, cycle, "coupler.P");
    expectSignalsClose(p.vx, derivative(p.x, dt), 1e-3);
    expectSignalsClose(p.vy, derivative(p.y, dt), 1e-3);
    expectSignalsClose(p.ax, derivative(p.vx, dt), 1e-3);
    expectSignalsClose(p.ay, derivative(p.vy, dt), 1e-3);
  });

  it("measures the rocker swing between its two limit positions", () => {
    // The rocker is at a limit when crank and coupler are in line.
    const angleAt = (reach: number): number =>
      Math.acos((rocker ** 2 + ground ** 2 - reach ** 2) / (2 * rocker * ground));
    const swing = angleAt(coupler + crank) - angleAt(coupler - crank);
    // Sampling every degree misses the exact limits by a little.
    expect(measure(simulation, "rocker_swing")).toBeCloseTo(swing, 4);
  });
});

describe("shaker", () => {
  const simulation = example("shaker");

  it("solves a multi-loop mechanism with one degree of freedom", () => {
    expect(simulation.cycle?.count).toBe(360);
    expect(simulation.mobility).toMatchObject({
      coordinates: 21,
      mobility: 1,
      free: 0,
      redundant: 0,
    });
  });

  it("moves the two decks equally and against each other", () => {
    const upper = measure(simulation, "upper_stroke");
    expect(measure(simulation, "lower_stroke")).toBeCloseTo(upper, 10);
    expect(measure(simulation, "opposition")).toBeCloseTo(2 * upper, 10);
  });
});
