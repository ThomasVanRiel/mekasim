import { simulate as simulateModel } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";
import {
  type JointValue,
  jointValue,
  lockInequalities,
  stopInequalities,
} from "../src/solver/inequality.ts";

const DEG = Math.PI / 180;

function errors(text: string): { message: string; path?: (string | number)[] }[] {
  return simulate(text)
    .diagnostics.filter(({ severity }) => severity === "error")
    .map(({ message, path }) => ({ message, path }));
}

/** An arm on a pin, turned up by a spring towards 70 degrees. */
const arm = (pin: string, rest = "") =>
  `mekafit: 1
bodies:
  ground:
    points: { O: [0, 0], Q: [100, 0] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O]${pin} }
  weld: { type: distance, connect: [ground.Q, arm.P], length: 300 }
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
${rest}`.replace("  weld: { type: distance, connect: [ground.Q, arm.P], length: 300 }\n", "");

/** A ram on a slide along x, 40 mm out. */
const ram = (guide: string, rest: string) => `mekafit: 1
bodies:
  ground:
    points: { A: [0, 0], B: [100, 0] }
  ram:
    points: { P: [0, 0] }
joints:
  guide: { type: slider, axis: [ground.A, ground.B], point: ram.P${guide} }
pose:
  ram: [40, 0, 0]
${rest}cycle: { steps: 20 }
`;

describe("the value of a joint", () => {
  it("is the second body's angle less the first's for a pin", () => {
    const value: JointValue = { kind: "angle", a: 0, b: 1 };
    const gradient = new Float64Array(6);
    expect(jointValue(value, Float64Array.of(0, 0, 0.2, 0, 0, 0.5), gradient)).toBeCloseTo(0.3, 14);
    expect(Array.from(gradient)).toEqual([0, 0, -1, 0, 0, 1]);
  });

  it("is how far the pin is along the axis, with a gradient that is its slope", () => {
    const value: JointValue = {
      kind: "travel",
      from: { body: 0, u: 0.01, v: 0.02 },
      to: { body: 0, u: 0.05, v: 0.04 },
      pin: { body: 1, u: -0.01, v: 0.03 },
    };
    const q = Float64Array.of(0.1, -0.2, 0.7, 0.15, -0.1, -0.4);
    const gradient = new Float64Array(6);
    jointValue(value, q, gradient);
    const h = 1e-7;
    for (let i = 0; i < 6; i++) {
      const ahead = Float64Array.from(q);
      const behind = Float64Array.from(q);
      ahead[i] += h;
      behind[i] -= h;
      expect(gradient[i]).toBeCloseTo(
        (jointValue(value, ahead) - jointValue(value, behind)) / (2 * h),
        7,
      );
    }
    // With the axis body where it is drawn, along x, it is the pin's x from the first point.
    const along: JointValue = {
      kind: "travel",
      from: { body: -1, u: 0.01, v: 0 },
      to: { body: -1, u: 0.05, v: 0 },
      pin: { body: 0, u: 0, v: 0 },
    };
    expect(jointValue(along, Float64Array.of(0.04, 0.3, 1))).toBeCloseTo(0.03, 14);
  });

  it("makes a row for each end of a stop, and one for a lock that is in", () => {
    const value: JointValue = { kind: "angle", a: -1, b: 0 };
    const q = Float64Array.of(0, 0, 0.5);
    const bodies: [string, string] = ["ground", "arm"];
    const rows = stopInequalities([{ joint: "pin", value, low: 0.2, high: 0.6, bodies }], q);
    expect(rows.map((row) => row.value)).toEqual([0.3, 0.09999999999999998]);
    expect(rows.map((row) => Array.from(row.gradient))).toEqual([
      [0, 0, 1],
      [-0, -0, -1],
    ]);
    expect(stopInequalities([{ joint: "pin", value, high: 0.6, bodies }], q)).toHaveLength(1);

    const lock = { id: "catch", joint: "pin", value, at: 0.4, engaged: false, bodies };
    expect(lockInequalities([{ ...lock, drops: "up" }], new Set(), q)).toEqual([]);
    const up = lockInequalities([{ ...lock, drops: "up" }], new Set(["catch"]), q);
    expect(up[0]).toMatchObject({ source: "catch", kind: "lock", between: bodies });
    expect(up[0]?.value).toBeCloseTo(0.1, 14);
    // One that dropped in going down holds the joint below its place: here it is 0.1 past it.
    const down = lockInequalities([{ ...lock, drops: "down" }], new Set(["catch"]), q);
    expect(down[0]?.value).toBeCloseTo(-0.1, 14);
  });
});

describe("joint stops", () => {
  it("hold a sprung arm at the stop it is turned against", () => {
    const result = simulate(arm(", stops: [0 deg, 45 deg]"));
    expect(result.diagnostics).toEqual([]);
    expect(result.cycle?.q[2]).toBeCloseTo(45 * DEG, 9);
  });

  it("leave an end open with null, and read plain numbers in the document's unit", () => {
    expect(simulate(arm(", stops: [null, 45]")).cycle?.q[2]).toBeCloseTo(45 * DEG, 9);
    // With only a least angle the spring turns the arm all the way to its rest.
    expect(simulate(arm(", stops: [10, null]")).cycle?.q[2]).toBeCloseTo(70 * DEG, 5);
  });

  it("bring a joint that starts beyond its stop back to it", () => {
    const result = simulate(arm(", stops: [80 deg, 90 deg]"));
    expect(result.diagnostics).toEqual([]);
    expect(result.cycle?.q[2]).toBeCloseTo(80 * DEG, 9);
  });

  it("stop a pulled ram at the end of its travel, where it is held and not free", () => {
    const result = simulate(
      ram(
        ", stops: [0 mm, 60 mm]",
        "drivers:\n  tug:\n    move: ram\n    stages:\n      - { pull: [10 N, 0], time: 1 }\n",
      ),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.free).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.q[(cycle.count - 1) * 3]).toBeCloseTo(0.06, 9);
  });

  it("jam a body that is carried past one, and name the part and its stop", () => {
    const result = simulate(
      ram(
        ", stops: [0 mm, 60 mm]",
        "drivers:\n  shove:\n    move: ram\n    stages:\n      - { to: [80, 0, 0], time: 1 }\n",
      ),
    );
    const found = result.diagnostics.filter(({ severity }) => severity === "error");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/^Jams at 0\.5\d* s: "ram" against its stop$/);
    expect(found[0]?.path).toEqual(["joints", "guide", "stops"]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.q[(cycle.count - 1) * 3]).toBeCloseTo(0.06, 4);
  });

  it("say what is wrong with them, at their place", () => {
    expect(errors(arm(", stops: [45 deg, 0 deg]"))).toEqual([
      {
        message: "The first stop is beyond the second; give the lesser one first",
        path: ["joints", "pin", "stops"],
      },
    ]);
    expect(errors(arm(", stops: [0 mm, 45 deg]"))).toEqual([
      { message: "Expected an angle, got a length", path: ["joints", "pin", "stops", 0] },
    ]);
    expect(
      errors(
        arm("").replace(
          "springs:",
          "  far: { type: distance, connect: [ground.Q, arm.P], length: 80, stops: [0, 1] }\nsprings:",
        ),
      ),
    ).toEqual([
      {
        message:
          'Joint "far" is a distance; only a revolute joint, a slider or a pin-slot can have stops',
        path: ["joints", "far", "stops"],
      },
    ]);
  });

  it("are not mekasim's", () => {
    const text = arm(", stops: [0 deg, 45 deg]").replace("mekafit: 1", "mekasim: 1");
    expect(simulateModel(text).diagnostics.some(({ severity }) => severity === "error")).toBe(true);
  });
});

describe("a lock", () => {
  /** A spring that would bring the ram back to 40 mm, a pull out to 90 mm, then the ram let go. */
  const sprung = (latch: string) =>
    ram(
      "",
      `springs:
  back: { connect: [ground.A, ram.P], stiffness: 0.2 N/mm, length: 40 }
drivers:
  tug:
    move: ram
    stages:
      - { pull: [10 N, 0], time: 1 }
      - { pull: [0, 0], time: 1 }
latches:
${latch}
`,
    );

  it("drops in as the joint passes it, and holds when the pull lets go", () => {
    const result = simulate(sprung("  catch: { joint: guide, at: 60 mm, drops: up }"));
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    const x = (k: number) => cycle.q[3 * k] as number;
    const half = cycle.t.indexOf(1);
    // 10 N on 0.2 N/mm is 50 mm out, past the lock's place.
    expect(x(half)).toBeCloseTo(0.09, 8);
    // Let go, the spring brings the ram back as far as the lock.
    expect(x(cycle.count - 1)).toBeCloseTo(0.06, 9);
    const latched = result.latched.catch as Float64Array;
    expect(latched).toHaveLength(cycle.count);
    expect(latched[0]).toBe(0);
    expect(latched[half]).toBe(1);
    // It is in from the sample after the one in which the ram passed 60 mm, and stays in.
    const first = latched.indexOf(1);
    expect(x(first - 1)).toBeGreaterThan(0.06);
    expect(x(first - 2)).toBeLessThanOrEqual(0.06);
    expect(Array.from(latched.subarray(first)).every((value) => value === 1)).toBe(true);
  });

  it("stays out when the joint never reaches it, and the ram comes all the way back", () => {
    const result = simulate(sprung("  catch: { joint: guide, at: 95 mm, drops: up }"));
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.q[3 * (cycle.count - 1)]).toBeCloseTo(0.04, 7);
    expect(Array.from(result.latched.catch as Float64Array).every((value) => value === 0)).toBe(
      true,
    );
  });

  it("pulls its joint in when it comes within its catch, and then holds it", () => {
    // Pulled out to 90 mm, the ram is 5 mm short of a lock at 95 mm that catches from
    // 10 mm short with 15 N: more than the spring's 10 N there, so it is drawn in.
    const result = simulate(
      sprung("  catch: { joint: guide, at: 95 mm, drops: up, catch: 10 mm, pull: 15 N }"),
    );
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    const x = (k: number) => cycle.q[3 * k] as number;
    expect(Math.max(...Array.from({ length: cycle.count }, (_, k) => x(k)))).toBeGreaterThan(
      0.095 - 1e-9,
    );
    expect(result.latched.catch?.[cycle.count - 1]).toBe(1);
    // Let go, the spring brings it back as far as the lock.
    expect(x(cycle.count - 1)).toBeCloseTo(0.095, 8);
  });

  it("leaves its joint be when it stays outside its catch", () => {
    const result = simulate(
      sprung("  catch: { joint: guide, at: 95 mm, drops: up, catch: 3 mm, pull: 15 N }"),
    );
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.q[3 * cycle.t.indexOf(1)]).toBeCloseTo(0.09, 8);
    expect(cycle.q[3 * (cycle.count - 1)]).toBeCloseTo(0.04, 7);
    expect(Array.from(result.latched.catch as Float64Array).every((value) => value === 0)).toBe(
      true,
    );
  });

  it("is in from the start where the joint starts beyond it, unless it is said to be out", () => {
    // The ram starts at 40 mm, below a lock at 50 mm that drops going down.
    const begun = simulate(sprung("  catch: { joint: guide, at: 50 mm, drops: down }"));
    expect(begun.diagnostics).toEqual([]);
    const cycle = begun.cycle as NonNullable<typeof begun.cycle>;
    expect(begun.latched.catch?.[0]).toBe(1);
    expect(cycle.q[3 * cycle.t.indexOf(1)]).toBeCloseTo(0.05, 9);

    const out = simulate(
      sprung("  catch: { joint: guide, at: 50 mm, drops: down, engaged: false }"),
    );
    const pulled = out.cycle as NonNullable<typeof out.cycle>;
    expect(out.latched.catch?.[0]).toBe(0);
    expect(pulled.q[3 * pulled.t.indexOf(1)]).toBeCloseTo(0.09, 8);
  });

  it("holds from the start when it is engaged", () => {
    // In from the start at 50 mm, going down: the ram cannot be pulled out past it.
    const result = simulate(
      sprung("  catch: { joint: guide, at: 50 mm, drops: down, engaged: true }"),
    );
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.q[3 * cycle.t.indexOf(1)]).toBeCloseTo(0.05, 9);
    expect(result.latched.catch?.[0]).toBe(1);
  });

  it("says what is wrong with it, at its place", () => {
    expect(errors(sprung("  catch: { joint: slide, at: 60 mm, drops: up }"))).toEqual([
      { message: 'Unknown joint "slide"', path: ["latches", "catch", "joint"] },
    ]);
    expect(errors(sprung("  catch: { joint: guide, at: 60 deg, drops: up }"))).toEqual([
      { message: "Expected a length, got an angle", path: ["latches", "catch", "at"] },
    ]);
    expect(
      errors(sprung("  catch: { joint: guide, at: 60 mm, drops: sideways }")).length,
    ).toBeGreaterThan(0);
    expect(errors(sprung("  catch: { joint: guide, at: 60 mm, drops: up, catch: 5 mm }"))).toEqual([
      {
        message:
          "A lock that pulls its joint in needs both `catch`, how far short of `at` it starts, and `pull`, how hard",
        path: ["latches", "catch", "pull"],
      },
    ]);
    expect(
      errors(sprung("  catch: { joint: guide, at: 60 mm, drops: up, catch: 5 mm, pull: 2 N*m }")),
    ).toEqual([
      {
        message: "Expected a quantity in m·kg/s², got a quantity in m²·kg/s²",
        path: ["latches", "catch", "pull"],
      },
    ]);
  });
});
