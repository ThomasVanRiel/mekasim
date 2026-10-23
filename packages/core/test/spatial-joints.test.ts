import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/simulate.ts";
import { maxAbs } from "../src/solver/linalg.ts";
import { residual } from "../src/solver/solve.ts";
import {
  cross,
  placePoint,
  quaternion,
  SHEET,
  turn,
  turningRate,
  unit,
  type Vec3,
} from "../src/solver/spatial.ts";

const HOOKE = readFileSync(
  new URL("../../../examples/spatial/hooke-joint.mekasim.yaml", import.meta.url),
  "utf8",
);

function errors(text: string): string[] {
  return simulate(text)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.message);
}

function measure(simulation: ReturnType<typeof simulate>, id: string): number | Float64Array {
  const found = simulation.measures.find((m) => m.id === id);
  if (!found?.quantity) throw new Error(`no measure ${id}: ${found?.error}`);
  return found.quantity.value;
}

describe("turningRate", () => {
  it("turns every direction of a body in space as its Euler parameters change", () => {
    const p = quaternion(unit([0.3, -0.5, 0.8]), 0.9);
    const q = Float64Array.of(0.1, 0.2, 0.3, ...p);
    // Rates that keep the Euler parameters of unit length: square to p.
    const raw = [0.4, -0.7, 0.2, 0.5];
    const along = raw.reduce((sum, r, i) => sum + r * (p[i] as number), 0);
    const pd = raw.map((r, i) => r - along * (p[i] as number));
    const qd = Float64Array.of(0, 0, 0, ...pd);
    const body = { at: 0 };
    const w = turningRate(q, qd, body);
    const h = 1e-7;
    const ahead = Float64Array.from(q, (value, i) => value + h * (qd[i] as number));
    for (const s of [
      [1, 0, 0],
      [0.2, -0.4, 0.9],
    ] as Vec3[]) {
      const now = turn(q, body, s);
      const next = turn(ahead, body, s);
      const rate = now.map((value, i) => ((next[i] as number) - value) / h);
      const expected = cross(w, now);
      for (let i = 0; i < 3; i++) expect(rate[i]).toBeCloseTo(expected[i] as number, 5);
    }
  });

  it("turns a body in the plane about its plane's normal", () => {
    const plane = {
      origin: [0, 0, 0] as Vec3,
      x: [0, 1, 0] as Vec3,
      y: [0, 0, 1] as Vec3,
      normal: [1, 0, 0] as Vec3,
    };
    expect(
      turningRate(Float64Array.of(0, 0, 0.4), Float64Array.of(1, 2, 3), { at: 0, plane }),
    ).toEqual([3, 0, 0]);
    expect(
      turningRate(Float64Array.of(0, 0, 0.4), Float64Array.of(1, 2, 3), { at: 0, plane: SHEET }),
    ).toEqual([0, 0, 3]);
  });
});

describe("the Hooke's joint example", () => {
  const simulation = simulate(HOOKE);

  it("solves with one degree of freedom and no warnings", () => {
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0, idle: 0 });
    expect(simulation.cycle?.count).toBe(360);
  });

  it("speeds the output up and slows it down by the textbook amounts", () => {
    const bend = (30 * Math.PI) / 180;
    expect(measure(simulation, "slowest")).toBeCloseTo(Math.cos(bend), 6);
    expect(measure(simulation, "fastest")).toBeCloseTo(1 / Math.cos(bend), 6);
  });

  it("reads the driven hinge's angle as the drive turns it, all the way round", () => {
    const plot = simulation.plots.find((found) => found.id === "input_angle");
    const angle = plot?.series[0]?.quantity?.value as Float64Array;
    const t = simulation.cycle?.t as Float64Array;
    for (let k = 0; k < angle.length; k++)
      expect(angle[k]).toBeCloseTo(2 * Math.PI * (t[k] as number), 8);
  });

  it("traces the output's yoke in space, square to the output shaft", () => {
    const { compiled } = simulation;
    expect(compiled?.traces).toEqual(["output.Y"]);
    const cycle = simulation.cycle;
    const output = compiled?.spatial.get("output");
    if (!cycle || !output) throw new Error("does not solve");
    // The yoke's end stays square to the shaft, on a circle about it.
    const bend = (30 * Math.PI) / 180;
    for (let k = 0; k < cycle.count; k += 7) {
      const q = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
      const [x, y, z] = placePoint(q, { at: output.at, s: [0, 0, 0.02] });
      expect(x * Math.cos(bend) + y * Math.sin(bend)).toBeCloseTo(0, 9);
      expect(Math.hypot(x, y, z)).toBeCloseTo(0.02, 9);
    }
  });
});

/** A crank turning about z drives, through a rod with a ball at each end, a block on a line out of the sheet. */
function sliderCrank(guide: string, extra = ""): string {
  return `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0, 0], P: [40, 0, 30], Q: [80, 0, 60], R: [40, 50, 30] } }
  crank: { spatial: true, points: { O: [0, 0, 0], A: [15, 0, 0] } }
  rod: { spatial: true, points: { A: [0, 0, 0], B: [39.05, 0, 0] } }
  block: { spatial: true, points: { B: [0, 0, 0], C: [10, 0, 0] } }
joints:
  main: { type: revolute, connect: [ground.O, crank.O] }
  ball_a: { type: spherical, connect: [crank.A, rod.A] }
  ball_b: { type: spherical, connect: [rod.B, block.B] }
  guide: ${guide}
drivers:
  motor: { joint: main, speed: 60 }
pose:
  rod: { at: [15, 0, 0], axis: [0, 1, 0], angle: -50.19 deg }
  block: { at: [40, 0, 30] }
${extra}`;
}

describe("joints along a line or on a face, in space", () => {
  it("keeps a slider's block on its line and square to it, through a whole turn", () => {
    const simulation = simulate(
      sliderCrank("{ type: slider, axis: [ground.P, ground.Q], point: block.B }"),
    );
    const { compiled, cycle } = simulation;
    if (!compiled || !cycle) throw new Error("does not solve");
    expect(simulation.mobility).toMatchObject({
      mobility: 1,
      free: 0,
      idle: 1,
      idleBodies: ["rod"],
    });
    expect(compiled.spatialJoints.map((j) => j.type)).toEqual([
      "revolute",
      "spherical",
      "spherical",
      "slider",
    ]);
    const block = compiled.spatial.get("block");
    if (!block) throw new Error("no block");
    for (let k = 0; k < cycle.count; k += 10) {
      const q = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
      expect(maxAbs(residual(compiled.model, q, cycle.t[k] as number))).toBeLessThan(1e-10);
      const [x, y, z] = placePoint(q, { at: block.at, s: [0, 0, 0] });
      // On the line through P along (4, 0, 3), and not turned at all.
      expect(y).toBeCloseTo(0, 9);
      expect(3 * (x - 0.04) - 4 * (z - 0.03)).toBeCloseTo(0, 9);
      const along = turn(q, { at: block.at }, [1, 0, 0]);
      expect(along[0]).toBeCloseTo(1, 9);
    }
  });

  it("lets a sleeve's block turn about its line as well, which is one more freedom", () => {
    const simulation = simulate(
      sliderCrank("{ type: cylindrical, connect: [ground.P, block.B], axis: [4, 0, 3] }"),
    );
    expect(simulation.mobility).toMatchObject({ mobility: 2, free: 1, idle: 1 });
  });

  it("lets a pin in a slot in space turn every way about its pin", () => {
    const simulation = simulate(
      sliderCrank("{ type: pin-slot, axis: [ground.P, ground.Q], point: block.B }"),
    );
    // The block turns three ways about B, one of them about its own line BC.
    expect(simulation.mobility).toMatchObject({ mobility: 3, free: 2, idle: 2 });
  });

  it("keeps a point on a face through three points", () => {
    const simulation = simulate(
      sliderCrank("{ type: point-plane, surface: [ground.P, ground.Q, ground.R], point: block.B }"),
    );
    const { compiled, cycle } = simulation;
    if (!compiled || !cycle) throw new Error("does not solve");
    const block = compiled.spatial.get("block");
    if (!block) throw new Error("no block");
    // The face is the plane through P square to (3, 0, -4).
    const q = cycle.q.subarray(0, cycle.width);
    const [x, , z] = placePoint(q, { at: block.at, s: [0, 0, 0] });
    expect(3 * (x - 0.04) - 4 * (z - 0.03)).toBeCloseTo(0, 9);
  });

  it("says what is wrong with joints in space that cannot be built", () => {
    expect(
      errors(
        sliderCrank("{ type: slider, axis: [ground.P, ground.Q], point: block.B, angle: 10 deg }"),
      ),
    ).toEqual(["In space a slider keeps the turning it starts with, so leave out its angle"]);
    expect(
      errors(
        sliderCrank(
          "{ type: point-plane, surface: [ground.O, ground.P, ground.Q], point: block.B }",
        ),
      ),
    ).toEqual(["The three points lie on one line, so they make no plane"]);
    expect(
      errors(
        sliderCrank(
          "{ type: universal, connect: [rod.B, block.B], pins: [[0, 1, 0], [0, 1, 1]] }",
        ).replace("  ball_b: { type: spherical, connect: [rod.B, block.B] }\n", ""),
      ),
    ).toEqual(["The two pins of the cross must be square to each other"]);
  });
});

describe("measures of hinges and bodies in space", () => {
  const model = (measures: string): string =>
    sliderCrank(
      "{ type: slider, axis: [ground.P, ground.Q], point: block.B }",
      `measures:\n${measures}`,
    );
  const of = (expression: string): { value?: number | Float64Array; error?: string } => {
    const result = simulate(model(`  m: ${expression}`)).measures.find((m) => m.id === "m");
    return { value: result?.quantity?.value, error: result?.error };
  };

  it("measures a hinge in space as its driver turns it", () => {
    const omega = of("omega(main)").value as Float64Array;
    expect(omega[100]).toBeCloseTo(2 * Math.PI, 8);
    expect((of("alpha(main)").value as Float64Array)[100]).toBeCloseTo(0, 6);
  });

  it("measures the angle at a point in space, without a sign", () => {
    const angle = of("angle(crank.A, rod.A, rod.B)").value as Float64Array;
    for (const value of angle) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(Math.PI);
    }
  });

  it("says that a body in space has no one angle, and which hinge has", () => {
    expect(of("angle(crank)").error).toBe(
      '"crank" moves in space, so it has no one angle: ask for the angle of one of its hinges, such as angle(main), or of three of its points',
    );
    expect(of("angle(ball_a)").error).toBe(
      '"ball_a" is a spherical joint; only hinges (revolute joints) have an angle',
    );
  });
});

describe("the angle of a hinge in the plane", () => {
  it("is the second body's angle less the first's", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0, 0] } }
  crank: { points: { O: [0, 0, 0], A: [20, 0, 0] } }
  arm: { points: { A: [0, 0, 0], B: [30, 0, 0] } }
joints:
  main: { type: revolute, connect: [ground.O, crank.O] }
  elbow: { type: revolute, connect: [crank.A, arm.A] }
  weld: { type: distance, connect: [ground.O, arm.B], length: 40 }
drivers:
  motor: { joint: main, speed: 60 }
pose:
  arm: [20, 0, 40 deg]
measures:
  elbow_angle: angle(elbow)
  difference: angle(arm) - angle(crank)
  elbow_speed: omega(elbow)
  difference_speed: omega(arm) - omega(crank)
`;
    const simulation = simulate(text);
    const elbow = measure(simulation, "elbow_angle") as Float64Array;
    const difference = measure(simulation, "difference") as Float64Array;
    const speed = measure(simulation, "elbow_speed") as Float64Array;
    const differenceSpeed = measure(simulation, "difference_speed") as Float64Array;
    for (let k = 0; k < elbow.length; k += 15) {
      expect(elbow[k]).toBeCloseTo(difference[k] as number, 12);
      expect(speed[k]).toBeCloseTo(differenceSpeed[k] as number, 12);
    }
  });
});

describe("the jerk of a point in space", () => {
  it("is how fast its acceleration changes", () => {
    const text = `${HOOKE.replace("measures:", "measures:\n  jx_y: jx(output.Y)\n  jy_y: jy(output.Y)\n  jz_y: jz(output.Y)\n  ax_y: ax(output.Y)\n  ay_y: ay(output.Y)\n  az_y: az(output.Y)\n  j_y: j(output.Y)")}`;
    const simulation = simulate(text);
    const t = simulation.cycle?.t as Float64Array;
    const dt = (t[1] as number) - (t[0] as number);
    for (const axis of ["x", "y", "z"]) {
      const jerk = measure(simulation, `j${axis}_y`) as Float64Array;
      const acceleration = measure(simulation, `a${axis}_y`) as Float64Array;
      const scale = Math.max(...(measure(simulation, "j_y") as Float64Array));
      for (let k = 1; k < jerk.length - 1; k += 11) {
        const rate = ((acceleration[k + 1] as number) - (acceleration[k - 1] as number)) / (2 * dt);
        expect(Math.abs((jerk[k] as number) - rate)).toBeLessThan(1e-3 * scale);
      }
    }
  });

  it("is not seen from a frame yet", () => {
    const text = `${HOOKE}frames:\n  f: { origin: ground.I }\n`.replace(
      "measures:",
      "measures:\n  seen: x(output.Y, f)",
    );
    const found = simulate(text).measures.find((m) => m.id === "seen");
    expect(found?.error).toBe(
      "A point off the sheet cannot be seen from a frame yet; frames are on the sheet",
    );
  });
});
