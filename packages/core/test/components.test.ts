import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pointMotion } from "../src/analysis/measures.ts";
import { type Simulation, simulate } from "../src/simulate.ts";
import { camOutlines, camProfile } from "../src/solver/cam.ts";

function example(name: string): Simulation {
  const text = readFileSync(
    new URL(`../../../examples/${name}.mekasim.yaml`, import.meta.url),
    "utf8",
  );
  return simulate(text);
}

function measure(simulation: Simulation, id: string): number {
  return simulation.measures.find((m) => m.id === id)?.quantity?.value as number;
}

function errors(text: string): string[] {
  return simulate(text)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.message);
}

describe("components", () => {
  const written = example("shaker");
  const built = example("shaker-components");

  it("build the same mechanism as the one written out point by point", () => {
    expect(built.diagnostics).toEqual([]);
    expect(built.cycle?.count).toBe(360);
    expect(built.mobility).toMatchObject({ coordinates: 21, mobility: 1, free: 0, redundant: 0 });
    for (const id of ["rocker_swing", "upper_stroke", "lower_stroke", "upper_peak_g"]) {
      expect(measure(built, id)).toBeCloseTo(measure(written, id), 9);
    }
  });

  it("stand for ordinary bodies, joints and drivers", () => {
    const { compiled } = built;
    expect(compiled?.model.bodies).toEqual([
      "eccentric",
      "rocker",
      "upper_arm",
      "lower_arm",
      "pitman",
      "upper_deck",
      "lower_deck",
    ]);
    expect(compiled?.joints.map((j) => j.id)).toEqual([
      "eccentric",
      "rocker",
      "upper_arm",
      "lower_arm",
      "pitman_a",
      "pitman_b",
      "upper_deck_a",
      "upper_deck_b",
      "lower_deck_a",
      "lower_deck_b",
    ]);
    expect(compiled?.drivers.map((d) => [d.id, d.joint])).toEqual([["eccentric", "eccentric"]]);
    expect([...(compiled?.bodies.get("ground")?.points.keys() ?? [])]).toEqual([
      "eccentric",
      "rocker",
      "upper_arm",
      "lower_arm",
    ]);
  });

  it("start rods where their ends are, so they assemble without a pose", () => {
    const q0 = built.compiled?.model.q0 as Float64Array;
    // The pitman is body 4: it starts on the eccentric pin, pointing at the rocker's drive point.
    expect(q0[12]).toBeCloseTo(0, 12);
    expect(q0[13]).toBeCloseTo(0.015, 12);
    expect(q0[14]).toBeCloseTo(Math.atan2(0.045, 0.5), 12);
  });

  it("report a mistake on the component it comes from", () => {
    const broken = simulate(
      readFileSync(
        new URL("../../../examples/shaker-components.mekasim.yaml", import.meta.url),
        "utf8",
      ).replace("arms: { A: [ecc, 90] }", "arms: { A: [eccc, 90] }"),
    );
    const [error] = broken.diagnostics.filter((d) => d.severity === "error");
    expect(error?.message).toBe('Unknown parameter "eccc" in "(eccc) * cos(90)"');
    expect(error?.path).toEqual(["components", "eccentric"]);
    expect(error?.position?.line).toBe(18);
  });

  it("refuse names that are already taken", () => {
    const text = `
mekasim: 1
bodies:
  shaft: { points: { A: [0, 0] } }
components:
  shaft: { type: crank, at: [0, 0], arms: { O: [10, 0] } }
`;
    expect(errors(text)).toEqual([
      'A body named "shaft" already exists; rename it or the component',
      '"O" is the pivot of a crank and cannot name an arm',
    ]);
  });

  it("mount a crank on a moving point", () => {
    const text = `
mekasim: 1
components:
  arm: { type: crank, at: [0, 0], arms: { tip: [100, 0] }, speed: 60 }
  flag: { type: crank, at: arm.tip, arms: { end: [30, 90] }, angle: 45 }
`;
    const simulation = simulate(text);
    // The flag hangs free on the arm's tip: one undriven freedom, and it starts where asked.
    expect(simulation.mobility).toMatchObject({ mobility: 2, free: 1 });
    const q0 = simulation.compiled?.model.q0 as Float64Array;
    expect(Array.from(q0.subarray(3, 6))).toEqual([0.1, 0, Math.PI / 4]);
  });
});

describe("layers", () => {
  it("put bodies that share a joint on different layers unless the model says otherwise", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { G1: [0, 0], G2: [180, 0] } }
  link1: { points: { A: [0, 0], B: [0, 40] } }
  link2: { points: { A: [0, 40], B: [140, 100] } }
  link3: { points: { A: [140, 100], B: [180, 0] } }
  fixed: { points: { A: [140, 100], B: [200, 100] }, layer: 0 }
joints:
  pin1: { type: revolute, connect: [ground.G1, link1.A] }
  pin2: { type: revolute, connect: [link1.B, link2.A] }
  pin3: { type: revolute, connect: [link2.B, link3.A] }
  pin4: { type: revolute, connect: [link3.B, ground.G2] }
  pin5: { type: revolute, connect: [link3.A, fixed.A] }
`;
    const bodies = simulate(text).compiled?.bodies;
    const layer = (id: string) => bodies?.get(id)?.layer;
    expect([layer("link1"), layer("link2"), layer("link3"), layer("fixed")]).toEqual([0, 1, 2, 0]);
  });
});

describe("gears and belts", () => {
  const geared = example("geared-five-bar");

  it("turn the wheel against the pinion in the ratio of their sizes", () => {
    expect(geared.diagnostics).toEqual([]);
    expect(geared.cycle?.count).toBe(720);
    expect(geared.mobility).toMatchObject({ mobility: 1, free: 0 });
    // The pinion turns at 120 rpm; a wheel twice its size turns at 60 rpm the other way.
    expect(measure(geared, "wheel_speed")).toBeCloseTo(-2 * Math.PI, 9);
  });

  it("close the path of the coupler point after two turns of the pinion", () => {
    const { compiled, cycle } = geared;
    if (!compiled || !cycle) throw new Error("not solved");
    const tip = pointMotion(compiled, cycle, "left.B");
    const dt = cycle.t[1] - cycle.t[0];
    // One step beyond the last sample lands on the first.
    expect(tip.x[719] + tip.vx[719] * dt).toBeCloseTo(tip.x[0], 5);
    expect(tip.y[719] + tip.vy[719] * dt).toBeCloseTo(tip.y[0], 5);
    // After a single turn it is somewhere else.
    expect(Math.hypot(tip.x[360] - tip.x[0], tip.y[360] - tip.y[0])).toBeGreaterThan(0.01);
  });

  it("turn belted wheels the same way", () => {
    const text = `
mekasim: 1
components:
  motor: { type: crank, at: [0, 0], arms: { m: [10, 0] }, speed: 90 }
  shaft: { type: crank, at: [200, 0], arms: { s: [30, 0] } }
joints:
  drive: { type: belt, connect: [motor.O, shaft.O], sizes: [50 mm, 150 mm] }
measures:
  shaft_speed: mean(omega(shaft))
`;
    const simulation = simulate(text);
    expect(simulation.diagnostics).toEqual([]);
    // 90 rpm through a 1:3 belt is 30 rpm, the same way round.
    expect(measure(simulation, "shaft_speed")).toBeCloseTo(Math.PI, 9);
  });

  it("want both sizes in the same kind of unit, and positive", () => {
    const model = (sizes: string) => `
mekasim: 1
components:
  a: { type: crank, at: [0, 0], arms: { p: [10, 0] } }
  b: { type: crank, at: [50, 0], arms: { p: [10, 0] } }
joints:
  mesh: { type: gear, connect: [a.O, b.O], sizes: ${sizes} }
`;
    expect(errors(model("[20, 40 mm]"))).toEqual([
      "Give both sizes as tooth counts or both as diameters",
    ]);
    expect(errors(model("[20, 0]"))).toEqual(["Sizes must be positive numbers"]);
  });
});

describe("cam", () => {
  const cam = example("cam-follower");

  it("lifts the follower by the lift of its profile", () => {
    expect(cam.diagnostics).toEqual([]);
    expect(cam.cycle?.count).toBe(360);
    expect(cam.mobility).toMatchObject({ mobility: 1, free: 0 });
    expect(measure(cam, "travel")).toBeCloseTo(0.012, 6);
  });

  it("moves the follower as the lift diagram says", () => {
    const { compiled, cycle } = cam;
    if (!compiled || !cycle) throw new Error("not solved");
    const follower = pointMotion(compiled, cycle, "lifter.P");
    const profile = camProfile(
      0.03,
      [
        { angle: 0, lift: 0 },
        { angle: (120 * Math.PI) / 180, lift: 0.012 },
        { angle: Math.PI, lift: 0.012 },
        { angle: (300 * Math.PI) / 180, lift: 0 },
      ],
      "cycloidal",
    );
    for (let k = 0; k < cycle.count; k++) {
      // The follower stands at 90 degrees; the cam has turned k degrees under it.
      expect(follower.y[k]).toBeCloseTo(profile.radius(((90 - k) * Math.PI) / 180), 9);
      expect(follower.x[k]).toBeCloseTo(0, 9);
    }
  });

  it("has velocities and accelerations consistent with the positions", () => {
    const { compiled, cycle } = cam;
    if (!compiled || !cycle) throw new Error("not solved");
    const { y, vy, ay } = pointMotion(compiled, cycle, "lifter.P");
    const dt = cycle.t[1] - cycle.t[0];
    const n = cycle.count;
    const peakV = Math.max(...vy.map(Math.abs));
    const peakA = Math.max(...ay.map(Math.abs));
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      const previous = (k - 1 + n) % n;
      expect(Math.abs(vy[k] - (y[next] - y[previous]) / (2 * dt))).toBeLessThan(2e-3 * peakV);
      // The jerk of a cycloidal rise jumps where it starts and ends, which a difference smears.
      expect(Math.abs(ay[k] - (vy[next] - vy[previous]) / (2 * dt))).toBeLessThan(2e-2 * peakA);
    }
  });

  it("rejects a lift diagram whose angles do not rise", () => {
    const text = readFileSync(
      new URL("../../../examples/cam-follower.mekasim.yaml", import.meta.url),
      "utf8",
    ).replace("[180, lift]", "[100, lift]");
    expect(errors(text)).toEqual(["Profile angles must rise from 0 and stay below a full turn"]);
  });
});

describe("camProfile", () => {
  const knots = [
    { angle: 0, lift: 0 },
    { angle: 2, lift: 0.01 },
    { angle: 3, lift: 0.01 },
    { angle: 5, lift: 0 },
  ];

  it.each(["cycloidal", "harmonic", "polynomial"] as const)(
    "%s meets the knots and dwells between equal ones",
    (law) => {
      const profile = camProfile(0.03, knots, law);
      expect(profile.radius(0)).toBeCloseTo(0.03, 12);
      expect(profile.radius(2)).toBeCloseTo(0.04, 12);
      expect(profile.radius(2.5)).toBe(0.04);
      expect(profile.slope(2.5)).toBe(0);
      // From the last knot round to the first it stays at zero lift.
      expect(profile.radius(6)).toBe(0.03);
      expect(profile.radius(-0.1)).toBe(0.03);
      // Halfway up the rise it is halfway up.
      expect(profile.radius(1)).toBeCloseTo(0.035, 12);
    },
  );

  it.each(["cycloidal", "harmonic", "polynomial"] as const)(
    "%s has derivatives that match its values",
    (law) => {
      const profile = camProfile(0.03, knots, law);
      const h = 1e-5;
      for (const theta of [0.3, 1.1, 1.9, 3.4, 4.7]) {
        const slope = (profile.radius(theta + h) - profile.radius(theta - h)) / (2 * h);
        const curve = (profile.slope(theta + h) - profile.slope(theta - h)) / (2 * h);
        expect(profile.slope(theta)).toBeCloseTo(slope, 8);
        expect(profile.curvature(theta)).toBeCloseTo(curve, 7);
      }
    },
  );

  it("draws the cam surface one roller radius inside the pitch curve", () => {
    const { pitch, surface } = camOutlines(camProfile(0.03, [], "cycloidal"), 0.008, 8);
    expect(pitch[0]).toEqual([0.03, 0]);
    expect(surface[0]?.[0]).toBeCloseTo(0.022, 12);
    expect(Math.hypot(...(surface[3] as [number, number]))).toBeCloseTo(0.022, 12);
  });
});

describe("distance joint", () => {
  it("stands in for a link between two points", () => {
    const withLink = `
mekasim: 1
bodies:
  ground: { points: { O2: [0, 0], O4: [180, 0] } }
  crank: { points: { O: [0, 0], A: [0, 40] } }
  rocker: { points: { B: [140, 100], O: [180, 0] } }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
  rock: { type: revolute, connect: [rocker.O, ground.O4] }
  tie: { type: distance, connect: [crank.A, rocker.B], length: "hypot(140, 60)" }
drivers:
  motor: { joint: main, speed: 60 }
measures:
  swing: range(angle(rocker))
  gap: range(dist(crank.A, rocker.B))
`;
    const simulation = simulate(withLink);
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0 });
    expect(measure(simulation, "gap")).toBeLessThan(1e-12);
    expect(measure(simulation, "swing")).toBeGreaterThan(0.5);
  });
});
