import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/analysis/csv.ts";
import { type Simulation, simulate } from "../src/simulate.ts";

function example(name: string): string {
  return readFileSync(new URL(`../../../examples/${name}.mekasim.yaml`, import.meta.url), "utf8");
}

/** An example with its frames, its measures and all after them replaced, but for the pose. */
function withFrames(name: string, frames: string, measures: string, rest = ""): Simulation {
  const text = example(name);
  const head = text.slice(0, text.search(/^(frames|measures):/m));
  const pose = text.includes("\npose:") ? text.slice(text.indexOf("\npose:")) : "";
  return simulate(`${head}frames:\n${frames}measures:\n${measures}${rest}${pose}`);
}

function signals(simulation: Simulation): (id: string) => Float64Array {
  expect(simulation.diagnostics).toEqual([]);
  return (id) => {
    const value = simulation.measures.find((m) => m.id === id)?.quantity?.value;
    if (typeof value !== "object") throw new Error(`"${id}" is not a signal`);
    return value;
  };
}

/** Central difference of a signal that repeats every cycle. */
function derivative(signal: Float64Array, dt: number): Float64Array {
  const n = signal.length;
  return signal.map((_, k) => (signal[(k + 1) % n] - signal[(k - 1 + n) % n]) / (2 * dt));
}

function expectClose(actual: Float64Array, expected: Float64Array, tolerance: number): void {
  const scale = expected.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  expect(actual).toHaveLength(expected.length);
  for (let k = 0; k < expected.length; k++) {
    expect(Math.abs(actual[k] - expected[k])).toBeLessThan(tolerance * scale + 1e-12);
  }
}

function expectStill(actual: Float64Array, tolerance: number): void {
  for (const value of actual) expect(Math.abs(value)).toBeLessThan(tolerance);
}

const combine = (a: Float64Array, b: Float64Array, f: (a: number, b: number) => number) =>
  a.map((x, k) => f(x, b[k] as number));

describe("a frame that stands still", () => {
  const of = signals(
    withFrames(
      "four-bar",
      `  upright: { angle: 90 }
  rocker_pivot: { origin: ground.O4 }
  sloping: { origin: ground.O4, angle: 30 }
`,
      `  x: x(coupler.P)
  y: y(coupler.P)
  vx: vx(coupler.P)
  vy: vy(coupler.P)
  ax: ax(coupler.P)
  jy: jy(coupler.P)
  x_up: x(coupler.P, upright)
  y_up: y(coupler.P, upright)
  vx_up: vx(coupler.P, upright)
  ay_up: ay(coupler.P, upright)
  jx_up: jx(coupler.P, upright)
  x_from: x(coupler.P, rocker_pivot)
  vx_from: vx(coupler.P, rocker_pivot)
  speed: v(coupler.P)
  speed_sloping: v(coupler.P, sloping)
  accel: a(coupler.P)
  accel_sloping: a(coupler.P, sloping)
  jerk: j(coupler.P)
  jerk_sloping: j(coupler.P, sloping)
  moved: moved(coupler.P)
  moved_sloping: moved(coupler.P, sloping)
  x_sloping: x(coupler.P, sloping)
  by_hand: (x(coupler.P) - 180) * cos(30) + y(coupler.P) * sin(30)
  centre: x(coupler, upright)
  centre_y: y(coupler)
`,
    ),
  );

  it("turns the axes: x of a frame turned a quarter is y of the sheet", () => {
    expectClose(of("x_up"), of("y"), 1e-12);
    expectClose(
      of("y_up"),
      of("x").map((x) => -x),
      1e-12,
    );
    expectClose(of("vx_up"), of("vy"), 1e-12);
    expectClose(
      of("ay_up"),
      of("ax").map((x) => -x),
      1e-12,
    );
    expectClose(of("jx_up"), of("jy"), 1e-12);
  });

  it("counts positions from its origin, which leaves the rates as they were", () => {
    expectClose(
      of("x_from"),
      of("x").map((x) => x - 0.18),
      1e-12,
    );
    expectClose(of("vx_from"), of("vx"), 1e-12);
  });

  it("does both at once", () => {
    expectClose(of("x_sloping"), of("by_hand"), 1e-12);
  });

  it("leaves the sizes of speed, acceleration, jerk and movement alone", () => {
    expectClose(of("speed_sloping"), of("speed"), 1e-12);
    expectClose(of("accel_sloping"), of("accel"), 1e-12);
    expectClose(of("jerk_sloping"), of("jerk"), 1e-12);
    expectClose(of("moved_sloping"), of("moved"), 1e-12);
  });

  it("takes a link for its centre, as on the sheet", () => {
    expectClose(of("centre"), of("centre_y"), 1e-12);
  });
});

describe("polar coordinates", () => {
  const simulation = withFrames(
    "four-bar",
    `  pivot: { origin: ground.O4, angle: 30 }
`,
    `  r: r(coupler.P, pivot)
  theta: theta(coupler.P, pivot)
  far: dist(ground.O4, coupler.P)
  direction: angle(ground.O4, coupler.P)
  vr: vr(coupler.P, pivot)
  vt: vt(coupler.P, pivot)
  ar: ar(coupler.P, pivot)
  at: at(coupler.P, pivot)
  jr: jr(coupler.P, pivot)
  jt: jt(coupler.P, pivot)
  v: v(coupler.P)
  a: a(coupler.P)
  j: j(coupler.P)
  sheet_r: r(coupler.P)
  sheet_theta: theta(coupler.P)
  x: x(coupler.P)
  y: y(coupler.P)
`,
  );
  const of = signals(simulation);
  const dt = (simulation.cycle?.t[1] ?? 0) - (simulation.cycle?.t[0] ?? 0);

  it("gives the distance from the origin and the direction from the frame's x axis", () => {
    expectClose(of("r"), of("far"), 1e-12);
    expectClose(
      of("theta"),
      of("direction").map((angle) => angle - Math.PI / 6),
      1e-12,
    );
  });

  it("is counted from the origin of the sheet when no frame is named", () => {
    expectClose(of("sheet_r"), combine(of("x"), of("y"), Math.hypot), 1e-12);
    expectClose(of("sheet_theta"), combine(of("y"), of("x"), Math.atan2), 1e-12);
  });

  it("splits the velocity into a part along the radius and a part across it", () => {
    const rate = derivative(of("r"), dt);
    const turn = derivative(of("theta"), dt);
    expectClose(of("vr"), rate, 1e-3);
    expectClose(
      of("vt"),
      combine(of("r"), turn, (r, w) => r * w),
      1e-3,
    );
    expectClose(combine(of("vr"), of("vt"), Math.hypot), of("v"), 1e-12);
  });

  it("splits the acceleration the same way, with the centripetal and Coriolis terms", () => {
    const r = of("r");
    const rate = derivative(r, dt);
    const turn = derivative(of("theta"), dt);
    const radial = derivative(rate, dt).map((rdd, k) => rdd - r[k] * turn[k] ** 2);
    const across = derivative(turn, dt).map((wd, k) => r[k] * wd + 2 * rate[k] * turn[k]);
    expectClose(of("ar"), radial, 5e-3);
    expectClose(of("at"), across, 5e-3);
    expectClose(combine(of("ar"), of("at"), Math.hypot), of("a"), 1e-12);
  });

  it("splits the jerk into the same two directions", () => {
    expectClose(combine(of("jr"), of("jt"), Math.hypot), of("j"), 1e-12);
  });
});

describe("a frame that moves with the mechanism", () => {
  const simulation = withFrames(
    "four-bar",
    `  on_coupler: { origin: coupler.A, body: coupler }
  on_line: { origin: coupler.A, along: [crank.A, rocker.B] }
  turned: { origin: coupler.A, body: coupler, angle: 90 }
  on_crank: { origin: crank.O, body: crank }
  to_rocker: { origin: crank.A, along: [crank.A, rocker.O] }
`,
    `  own_x: x(coupler.P, on_coupler)
  own_y: y(coupler.P, on_coupler)
  own_v: v(coupler.P, on_coupler)
  own_a: a(coupler.P, on_coupler)
  own_j: j(coupler.P, on_coupler)
  own_moved: moved(coupler.P, on_coupler)
  line_x: x(coupler.P, on_line)
  line_y: y(coupler.P, on_line)
  line_v: v(coupler.P, on_line)
  line_a: a(coupler.P, on_line)
  line_j: j(coupler.P, on_line)
  turned_x: x(coupler.P, turned)
  x: x(coupler.P, on_crank)
  y: y(coupler.P, on_crank)
  vx: vx(coupler.P, on_crank)
  vy: vy(coupler.P, on_crank)
  ax: ax(coupler.P, on_crank)
  ay: ay(coupler.P, on_crank)
  jx: jx(coupler.P, on_crank)
  jy: jy(coupler.P, on_crank)
  far_x: x(rocker.B, to_rocker)
  far_vx: vx(rocker.B, to_rocker)
  far_vy: vy(rocker.B, to_rocker)
  far_ax: ax(rocker.B, to_rocker)
  far_ay: ay(rocker.B, to_rocker)
  far_jx: jx(rocker.B, to_rocker)
  far_jy: jy(rocker.B, to_rocker)
  far_y: y(rocker.B, to_rocker)
`,
  );
  const of = signals(simulation);
  const dt = (simulation.cycle?.t[1] ?? 0) - (simulation.cycle?.t[0] ?? 0);

  it("sees a point of its own body stand still, where the body has it", () => {
    for (const frame of ["own", "line"]) {
      expectClose(of(`${frame}_x`), new Float64Array(360).fill(0.08), 1e-9);
      expectClose(of(`${frame}_y`), new Float64Array(360).fill(0.06), 1e-9);
      expectStill(of(`${frame}_v`), 1e-9);
      expectStill(of(`${frame}_a`), 1e-6);
      expectStill(of(`${frame}_j`), 1e-3);
    }
    expectStill(of("own_moved"), 1e-9);
    expectClose(of("turned_x"), new Float64Array(360).fill(0.06), 1e-9);
  });

  it("gives the rates at which the coordinates in the frame change", () => {
    for (const axis of ["x", "y"]) {
      expectClose(of(`v${axis}`), derivative(of(axis), dt), 1e-3);
      expectClose(of(`a${axis}`), derivative(of(`v${axis}`), dt), 1e-3);
      expectClose(of(`j${axis}`), derivative(of(`a${axis}`), dt), 1e-3);
    }
  });

  it("follows a line between points of two bodies, which also changes in length", () => {
    for (const axis of ["x", "y"]) {
      expectClose(of(`far_v${axis}`), derivative(of(`far_${axis}`), dt), 1e-3);
      expectClose(of(`far_a${axis}`), derivative(of(`far_v${axis}`), dt), 1e-3);
      expectClose(of(`far_j${axis}`), derivative(of(`far_a${axis}`), dt), 1e-3);
    }
  });
});

describe("a follower seen from its cam", () => {
  const of = signals(
    withFrames(
      "cam-follower",
      `  cam: { origin: camshaft.O, body: camshaft }
`,
      `  radius: r(lifter.P, cam)
  round: theta(lifter.P, cam)
`,
    ),
  );

  it("is at the base radius plus the lift, going once round the cam", () => {
    const radius = of("radius");
    expect(Math.min(...radius)).toBeCloseTo(0.03, 9);
    expect(Math.max(...radius)).toBeCloseTo(0.042, 9);
    expect(Math.abs((of("round")[359] as number) - (of("round")[0] as number))).toBeCloseTo(
      (2 * Math.PI * 359) / 360,
      9,
    );
  });
});

describe("mistakes with frames", () => {
  const errors = (frames: string, measures = "  x: x(coupler.P)\n") =>
    withFrames("four-bar", frames, measures)
      .diagnostics.filter((d) => d.severity === "error")
      .map((d) => [d.message, d.path]);

  it("reports a frame on a point or a body that is not there", () => {
    expect(errors("  f: { origin: coupler.Q }\n")).toEqual([
      ['Body "coupler" has no point "Q"', ["frames", "f", "origin"]],
    ]);
    expect(errors("  f: { body: nothing }\n")).toEqual([
      ['Unknown body "nothing"', ["frames", "f", "body"]],
    ]);
  });

  it("reports a frame that follows two things, or a line with no direction", () => {
    expect(errors("  f: { body: crank, along: [crank.O, crank.A] }\n")).toEqual([
      ["A frame follows either two points or a body, not both", ["frames", "f", "body"]],
    ]);
    expect(errors("  f: { along: [crank.A, crank.A] }\n")).toEqual([
      ["The two points coincide, so they define no direction", ["frames", "f", "along"]],
    ]);
    // The crank's pin and the coupler's end are pinned together.
    expect(errors("  f: { along: [crank.A, coupler.A] }\n", "  x: x(coupler.P, f)\n")).toEqual([
      [
        'The two points that frame "f" points along come together, so it has no direction there',
        ["measures", "x"],
      ],
    ]);
  });

  it("reports a frame that is not defined, and what is not a frame", () => {
    expect(errors("  f: {}\n", "  x: x(coupler.P, g)\n")).toEqual([
      ['Unknown frame "g"', ["measures", "x"]],
    ]);
    expect(errors("  f: {}\n", "  x: x(coupler.P, 30)\n")).toEqual([
      ["x() takes a point, and the name of a frame to see it from if wanted", ["measures", "x"]],
    ]);
    expect(errors("  f: {}\n", "  x: x(coupler.P, f, f)\n")).toEqual([
      ["x() takes a point, and a frame to see it from if wanted, got 3", ["measures", "x"]],
    ]);
  });
});

describe("a plot in a frame", () => {
  it("is a column of the CSV under the expression as written", () => {
    const simulation = withFrames(
      "four-bar",
      "  pivot: { origin: ground.O4 }\n",
      "  swing: range(angle(rocker))\n",
      "plots:\n  from_pivot:\n    - r(coupler.P, pivot)\n    - theta(coupler.P, pivot)\n",
    );
    expect(simulation.diagnostics).toEqual([]);
    const header = toCsv(simulation).split("\n")[0];
    expect(header).toContain('"r(coupler.P, pivot) [mm]","theta(coupler.P, pivot) [deg]"');
  });
});
