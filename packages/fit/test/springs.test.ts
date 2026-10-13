import { mat } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import type { FitCompiled } from "../src/index.ts";
import { simulate } from "../src/index.ts";
import { solveQp } from "../src/solver/qp.ts";
import { type CompiledSpring, springTerms, springValue } from "../src/solver/springs.ts";

const DEG = Math.PI / 180;

/** An arm on a pin at the origin, turned 30 degrees, with a point 100 mm along it. */
function model(springs: string): string {
  return `mekafit: 1
params:
  k: 2 N/mm
bodies:
  ground:
    points: { O: [0, 0], Q: [200, 0], A: [0, 50], B: [100, 50] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
  ram:
    points: { P: [0, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O] }
  guide: { type: slider, axis: [ground.A, ground.B], point: ram.P }
pose:
  arm: [0, 0, 30 deg]
  ram: [20, 50, 0]
springs:
${springs}
`;
}

function compiled(springs: string): CompiledSpring[] {
  const result = simulate(model(springs));
  expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  return (result.compiled as FitCompiled).springs;
}

/** Where the pose puts the arm and the ram, which is where the joints close too. */
const START = Float64Array.of(0, 0, 30 * DEG, 0.02, 0.05, 0);

function errors(springs: string): { message: string; path?: (string | number)[] }[] {
  return simulate(model(springs))
    .diagnostics.filter(({ severity }) => severity === "error")
    .map(({ message, path }) => ({ message, path }));
}

/** The energy's slope by central differences, to hold the written gradient against. */
function slope(springs: CompiledSpring[], q: Float64Array, h = 1e-7): number[] {
  return Array.from(q, (_, i) => {
    const ahead = Float64Array.from(q);
    const behind = Float64Array.from(q);
    ahead[i] += h;
    behind[i] -= h;
    return (springTerms(springs, ahead).energy - springTerms(springs, behind).energy) / (2 * h);
  });
}

const torsion: CompiledSpring = {
  id: "opener",
  kind: "torsion",
  joint: "pin",
  a: 0,
  b: 1,
  stiffness: 2,
  rest: 0.1,
};
const straight: CompiledSpring = {
  id: "return",
  kind: "straight",
  a: { body: -1, u: 0, v: 0 },
  b: { body: 0, u: 1, v: 0 },
  stiffness: 10,
  rest: 2,
};

describe("spring energy", () => {
  it("has the hand-calculated terms of a torsion spring", () => {
    const q = Float64Array.of(0, 0, 0.1, 0, 0, 0.5);
    const { energy, gradient, hessian } = springTerms([torsion], q);
    // Turned 0.4 rad, 0.3 rad past rest: 1/2 * 2 * 0.3^2, and a torque of 0.6 on each body.
    expect(springValue(torsion, q)).toBeCloseTo(0.4, 14);
    expect(energy).toBeCloseTo(0.09, 14);
    [0, 0, -0.6, 0, 0, 0.6].forEach((value, i) => {
      expect(gradient[i]).toBeCloseTo(value, 14);
    });
    expect(hessian.data[2 * 6 + 2]).toBe(2);
    expect(hessian.data[5 * 6 + 5]).toBe(2);
    expect(hessian.data[2 * 6 + 5]).toBe(-2);
    expect(hessian.data[5 * 6 + 2]).toBe(-2);
    expect(hessian.data.reduce((sum, value) => sum + Math.abs(value), 0)).toBe(8);
  });

  it("has the hand-calculated terms of a straight spring", () => {
    // The body's point is at (3, 0): 1 m longer than at rest, pulled back with 10 N.
    const q = Float64Array.of(2, 0, 0);
    const { energy, gradient, hessian } = springTerms([straight], q);
    expect(springValue(straight, q)).toBe(3);
    expect(energy).toBe(5);
    expect(Array.from(gradient)).toEqual([10, 0, 0]);
    // Along its line the spring's own stiffness; sideways its tension over its length,
    // which the point 1 m out from the body's origin feels in the body's turning as well.
    const sideways = 10 / 3;
    [10, 0, 0, 0, sideways, sideways, 0, sideways, sideways].forEach((value, i) => {
      expect(hessian.data[i]).toBeCloseTo(value, 12);
    });
  });

  it("leaves ground out of the coordinates", () => {
    const onGround: CompiledSpring = { ...torsion, a: -1, b: 0 };
    const { gradient } = springTerms([onGround], Float64Array.of(0, 0, 0.6));
    expect(gradient[2]).toBeCloseTo(1, 14);
  });

  it("has a gradient that is the slope of its energy", () => {
    const between: CompiledSpring = {
      id: "between",
      kind: "straight",
      a: { body: 0, u: 0.3, v: -0.2 },
      b: { body: 1, u: -0.1, v: 0.4 },
      stiffness: 7,
      rest: 0.5,
    };
    const springs = [torsion, between, { ...straight, b: { body: 1, u: 0.2, v: 0.1 } }];
    const q = Float64Array.of(0.4, -0.3, 0.7, 1.5, 0.9, -1.1);
    const { gradient, hessian } = springTerms(springs, q);
    slope(springs, q).forEach((value, i) => {
      expect(gradient[i]).toBeCloseTo(value, 6);
    });
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        expect(hessian.data[i * 6 + j]).toBeCloseTo(hessian.data[j * 6 + i] as number, 12);
      }
    }
  });

  it("has the exact Hessian of a straight spring at its rest length", () => {
    const q = Float64Array.of(0.6, 0.8, 0.3);
    const atRest: CompiledSpring = { ...straight, rest: springValue(straight, q) };
    const { hessian } = springTerms([atRest], q);
    const h = 1e-6;
    for (let j = 0; j < 3; j++) {
      const ahead = Float64Array.from(q);
      const behind = Float64Array.from(q);
      ahead[j] += h;
      behind[j] -= h;
      const up = springTerms([atRest], ahead).gradient;
      const down = springTerms([atRest], behind).gradient;
      for (let i = 0; i < 3; i++) {
        expect(hessian.data[i * 3 + j]).toBeCloseTo(
          ((up[i] as number) - (down[i] as number)) / (2 * h),
          5,
        );
      }
    }
  });

  it("has the sideways stiffness of a stretched straight spring", () => {
    // A point at a body's origin does not move as the body turns, so the Hessian is exact.
    const onOrigin: CompiledSpring = { ...straight, b: { body: 0, u: 0, v: 0 }, rest: 0.4 };
    const q = Float64Array.of(0.6, 0.8, 0.3);
    const { hessian } = springTerms([onOrigin], q);
    const h = 1e-6;
    for (let j = 0; j < 3; j++) {
      const ahead = Float64Array.from(q);
      const behind = Float64Array.from(q);
      ahead[j] += h;
      behind[j] -= h;
      const up = springTerms([onOrigin], ahead).gradient;
      const down = springTerms([onOrigin], behind).gradient;
      for (let i = 0; i < 3; i++) {
        expect(hessian.data[i * 3 + j]).toBeCloseTo(
          ((up[i] as number) - (down[i] as number)) / (2 * h),
          5,
        );
      }
    }
    // Pushed short, it is left out: the spring would rather go sideways, and the Hessian stay positive.
    const short = springTerms([{ ...onOrigin, rest: 2 }], q).hessian;
    expect(short.data[0]).toBeCloseTo(10 * 0.36, 12);
    expect(short.data[4]).toBeCloseTo(10 * 0.64, 12);
  });

  it("pulls no particular way when its two points are on one place", () => {
    const { energy, gradient } = springTerms([straight], Float64Array.of(-1, 0, 0));
    expect(energy).toBe(20);
    expect(Array.from(gradient)).toEqual([0, 0, 0]);
  });

  it("settles a sprung body at its rest angle in one step of the program", () => {
    const onGround: CompiledSpring = { ...torsion, a: -1, b: 0, rest: 0.25 };
    const q = Float64Array.of(0, 0, 1);
    const { gradient, hessian } = springTerms([onGround], q);
    // A little resistance to moving, as the contact step adds, keeps the program definite.
    for (let i = 0; i < 3; i++) hessian.data[i * 3 + i] += 1e-9;
    const step = solveQp(hessian, gradient, mat(0, 3), new Float64Array(0));
    expect((q[2] as number) + (step?.x[2] as number)).toBeCloseTo(0.25, 8);
    expect(step?.x[0]).toBeCloseTo(0, 12);
  });
});

describe("springs in a model", () => {
  it("reads both kinds in SI", () => {
    const springs = compiled(`  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
  return: { connect: [ram.P, ground.Q], stiffness: k, length: 40 }
  soft: { joint: pin, stiffness: 3 N*mm/deg, rest: 10 }`);
    expect(springs).toHaveLength(3);
    expect(springs[0]).toMatchObject({ id: "opener", kind: "torsion", a: -1, b: 0 });
    expect(springs[0]?.stiffness).toBeCloseTo(0.02, 14);
    expect(springs[0]?.rest).toBeCloseTo(70 * DEG, 14);
    expect(springs[1]).toMatchObject({
      id: "return",
      kind: "straight",
      a: { body: 1, u: 0, v: 0 },
      b: { body: -1, u: 0.2, v: 0 },
    });
    expect(springs[1]?.stiffness).toBeCloseTo(2000, 10);
    expect(springs[1]?.rest).toBeCloseTo(0.04, 14);
    expect(springs[2]?.stiffness).toBeCloseTo(0.003 / DEG, 12);
    expect(springs[2]?.rest).toBeCloseTo(10 * DEG, 14);
  });

  it("leaves a model without springs with none", () => {
    const result = simulate(model("").replace("springs:\n", ""));
    expect((result.compiled as FitCompiled).springs).toEqual([]);
  });

  it("turns a positive torsion preload the joint's positive way", () => {
    const [spring] = compiled(
      "  opener: { joint: pin, stiffness: 0.02 N*m/rad, preload: 10 N*mm }",
    );
    const q = START;
    expect(spring?.rest).toBeCloseTo(30 * DEG + 0.5, 12);
    // The torque on the arm is the downhill direction of the energy in its angle.
    expect(-(springTerms([spring as CompiledSpring], q).gradient[2] as number)).toBeCloseTo(
      0.01,
      12,
    );
  });

  it("turns a negative torsion preload the other way", () => {
    const [spring] = compiled(
      "  opener: { joint: pin, stiffness: 0.02 N*m/rad, preload: -10 N*mm }",
    );
    expect(spring?.rest).toBeCloseTo(30 * DEG - 0.5, 12);
  });

  it("pulls its two points together with a positive straight preload", () => {
    const text = "  return: { connect: [ram.P, ground.Q], stiffness: k, preload: 4 N }";
    const [spring] = compiled(text);
    const q = START;
    // The ram is 20 mm along its guide, 50 mm above the line through Q.
    const length = Math.hypot(0.18, 0.05);
    expect(spring?.rest).toBeCloseTo(length - 0.002, 12);
    const { gradient } = springTerms([spring as CompiledSpring], q);
    // The force on the ram is 4 N towards Q.
    expect(-(gradient[3] as number)).toBeCloseTo((4 * 0.18) / length, 10);
    expect(-(gradient[4] as number)).toBeCloseTo((4 * -0.05) / length, 10);
  });

  it("pushes them apart with a negative straight preload, and reads a plain 0 as none", () => {
    const length = Math.hypot(0.18, 0.05);
    const [pushing] = compiled(
      "  return: { connect: [ram.P, ground.Q], stiffness: k, preload: -4 N }",
    );
    expect(pushing?.rest).toBeCloseTo(length + 0.002, 12);
    const [slack] = compiled("  return: { connect: [ram.P, ground.Q], stiffness: k, preload: 0 }");
    expect(slack?.rest).toBeCloseTo(length, 12);
  });

  it("takes a preload where the joints close, not where the pose puts the bodies", () => {
    // The pose leaves the ram 10 mm off its guide; it closes straight down onto it.
    const text = model(
      "  return: { connect: [ram.P, ground.Q], stiffness: k, preload: 0 N }",
    ).replace("ram: [20, 50, 0]", "ram: [20, 60, 0]");
    const result = simulate(text);
    expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect((result.compiled as FitCompiled).springs[0]?.rest).toBeCloseTo(
      Math.hypot(0.18, 0.05),
      9,
    );
  });

  it("says what is wrong with a spring, at its place", () => {
    expect(errors("  s: { joint: hinge, stiffness: 1 N*m/rad, rest: 0 }")).toEqual([
      { message: 'Unknown joint "hinge"', path: ["springs", "s", "joint"] },
    ]);
    expect(errors("  s: { joint: guide, stiffness: 1 N*m/rad, rest: 0 }")).toEqual([
      {
        message: 'Joint "guide" is a slider; a spring can only turn a revolute joint',
        path: ["springs", "s", "joint"],
      },
    ]);
    expect(errors("  s: { connect: [ram.P, wall.Q], stiffness: k, length: 40 }")).toEqual([
      { message: 'Unknown body "wall"', path: ["springs", "s", "connect", 1] },
    ]);
    expect(errors("  s: { connect: [ram.P, ground.Z], stiffness: k, length: 40 }")).toEqual([
      { message: 'Body "ground" has no point "Z"', path: ["springs", "s", "connect", 1] },
    ]);
    expect(errors("  s: { connect: [ground.O, ground.Q], stiffness: k, length: 40 }")).toEqual([
      { message: "A spring must connect two different bodies", path: ["springs", "s", "connect"] },
    ]);
    expect(errors("  s: { connect: [ram.P, ground.Q], stiffness: k, length: -1 }")).toEqual([
      { message: "A spring's length cannot be less than zero", path: ["springs", "s", "length"] },
    ]);
  });

  it("asks for a stiffness and a preload with their units", () => {
    expect(errors("  s: { connect: [ram.P, ground.Q], stiffness: 2, length: 40 }")).toEqual([
      {
        message:
          "The stiffness of a spring between two points is a force for each length, such as 2 N/mm",
        path: ["springs", "s", "stiffness"],
      },
    ]);
    expect(errors("  s: { joint: pin, stiffness: k, rest: 0 }")).toEqual([
      {
        message:
          "The stiffness of a spring on a joint is a torque for each angle, such as 0.02 N*m/rad",
        path: ["springs", "s", "stiffness"],
      },
    ]);
    expect(errors("  s: { joint: pin, stiffness: 0 N*m/rad, rest: 0 }")).toEqual([
      { message: "The stiffness must be more than zero", path: ["springs", "s", "stiffness"] },
    ]);
    expect(errors("  s: { joint: pin, stiffness: 1 N*m/rad, preload: 4 N }")).toEqual([
      {
        message: "The preload of a spring on a joint is a torque, such as 0.5 N*m",
        path: ["springs", "s", "preload"],
      },
    ]);
    expect(errors("  s: { connect: [ram.P, ground.Q], stiffness: k, preload: 4 }")).toEqual([
      {
        message: "The preload of a spring between two points is a force, such as 5 N",
        path: ["springs", "s", "preload"],
      },
    ]);
    expect(errors("  s: { joint: pin, stiffness: 2 * stiff, rest: 0 }")).toEqual([
      {
        message: 'Unknown parameter "stiff" in "2 * stiff"',
        path: ["springs", "s", "stiffness"],
      },
    ]);
  });

  it("wants a rest value or a preload, and not both", () => {
    expect(errors("  s: { joint: pin, stiffness: 1 N*m/rad }")[0]?.message).toMatch(
      /^A spring on a joint needs `rest`/,
    );
    expect(errors("  s: { connect: [ram.P, ground.Q], stiffness: k }")[0]?.message).toMatch(
      /^A spring between two points needs `length`/,
    );
    expect(errors("  s: { joint: pin, stiffness: 1 N*m/rad, rest: 0, preload: 1 N*m }")).toEqual([
      {
        message: "Give either `rest` or `preload`, not both",
        path: ["springs", "s", "preload"],
      },
    ]);
    expect(
      errors("  s: { joint: pin, connect: [ram.P, ground.Q], stiffness: k }")[0]?.message,
    ).toBe("A spring is on a joint, or it connects two points");
  });

  it("settles a model with springs, where one without stays as it is posed", () => {
    const sprung = simulate(
      model("  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }"),
    );
    const plain = simulate(model("").replace("springs:\n", ""));
    expect(plain.cycle?.q[2]).toBeCloseTo(30 * DEG, 12);
    expect(sprung.cycle?.q[2]).toBeCloseTo(70 * DEG, 5);
  });
});
