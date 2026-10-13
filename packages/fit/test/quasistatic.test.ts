import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FitCompiled } from "../src/index.ts";
import { simulate } from "../src/index.ts";
import { solveQuasistatic } from "../src/solver/quasistatic.ts";
import { type CompiledMove, moveDuration, poseAt } from "../src/solver/stages.ts";

const DEG = Math.PI / 180;

function compile(text: string): FitCompiled {
  const result = simulate(text);
  expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  return result.compiled as FitCompiled;
}

/** A pusher, a loose block 20 mm ahead of it, and a wall 50 mm beyond the block. */
const pushing = (steps: number) => `mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
    shape: { path: "M 100 -20 H 110 V 40 H 100 Z" }
  pusher:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 20 H 0 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 20 V 20 H 0 Z" }
pose:
  block: [30, 0, 0]
contacts:
  push: { between: [pusher, block] }
  stop: { between: [block, ground] }
cycle: { steps: ${steps} }
`;

function push(compiled: FitCompiled, to: number): CompiledMove {
  return {
    id: "push",
    body: compiled.bodies.get("pusher")?.index as number,
    start: { x: 0, y: 0, angle: 0 },
    stages: [{ kind: "to", to: { x: to, y: 0, angle: 0 }, time: 1 }],
  };
}

describe("stages of a move", () => {
  const move: CompiledMove = {
    id: "push",
    body: 0,
    start: { x: 0, y: 0, angle: 0 },
    stages: [
      { kind: "to", to: { x: 2, y: 0, angle: 1 }, time: 2 },
      { kind: "to", to: { x: 0, y: 2, angle: 1 }, via: [2, 2], time: 4 },
    ],
  };

  it("goes straight and turns evenly", () => {
    expect(moveDuration(move)).toBe(6);
    expect(poseAt(move, 0)).toEqual({ x: 0, y: 0, angle: 0 });
    expect(poseAt(move, 0.5)).toEqual({ x: 0.5, y: 0, angle: 0.25 });
    expect(poseAt(move, 2)).toMatchObject({ x: 2, y: 0, angle: 1 });
  });

  it("goes along the arc through `via`", () => {
    // From (2, 0) through (2, 2) to (0, 2): half of the circle round (1, 1).
    const quarter = poseAt(move, 3);
    expect(quarter.x).toBeCloseTo(1 + Math.SQRT2, 12);
    expect(quarter.y).toBeCloseTo(1, 12);
    const half = poseAt(move, 4);
    expect(half.x).toBeCloseTo(2, 12);
    expect(half.y).toBeCloseTo(2, 12);
    expect(half.angle).toBe(1);
    const end = poseAt(move, 6 - 1e-9);
    expect(end.x).toBeCloseTo(0, 8);
    expect(end.y).toBeCloseTo(2, 8);
  });

  it("goes the other way round when `via` lies there", () => {
    const other: CompiledMove = {
      ...move,
      stages: [{ kind: "to", to: { x: 0, y: 2, angle: 0 }, via: [0, 0.0001], time: 1 }],
    };
    // Nearly a straight line up the y axis, so halfway is near (0, 1), not far out to the side.
    const half = poseAt(other, 0.5);
    expect(Math.abs(half.x)).toBeLessThan(0.01);
    expect(half.y).toBeCloseTo(1, 3);
  });

  it("goes straight when `via` is in line, and stays at the end afterwards", () => {
    const straight: CompiledMove = {
      ...move,
      stages: [{ kind: "to", to: { x: 4, y: 0, angle: 0 }, via: [1, 0], time: 1 }],
    };
    expect(poseAt(straight, 0.5)).toEqual({ x: 2, y: 0, angle: 0 });
    expect(poseAt(straight, 9)).toEqual({ x: 4, y: 0, angle: 0 });
  });
});

describe("the contact step", () => {
  it("pushes a loose block, which stays where it is left", () => {
    const compiled = compile(pushing(40));
    const { cycle, jam } = solveQuasistatic(compiled, [push(compiled, 0.04)]);
    expect(jam).toBeUndefined();
    expect(cycle.count).toBe(41);
    const block = 3 * (compiled.bodies.get("block")?.index as number);
    const at = (k: number, i: number) => cycle.q[k * cycle.width + block + i] as number;
    // Until the pusher's face, 10 mm ahead of it, reaches the block at 30 mm, nothing moves it.
    for (let k = 0; k <= 20; k++) expect(at(k, 0)).toBeCloseTo(0.03, 9);
    for (let k = 20; k <= 40; k++) {
      expect(at(k, 0)).toBeCloseTo(0.01 + k * 0.001, 8);
      expect(at(k, 1)).toBeCloseTo(0, 8);
      expect(at(k, 2)).toBeCloseTo(0, 8);
    }
    expect(cycle.t[40]).toBeCloseTo(1, 12);
  });

  it("adds samples where a body moves far in one, and still does not pass through", () => {
    const compiled = compile(pushing(4));
    const { cycle, jam } = solveQuasistatic(compiled, [push(compiled, 0.04)]);
    expect(jam).toBeUndefined();
    expect(cycle.count).toBeGreaterThan(5);
    const block = 3 * (compiled.bodies.get("block")?.index as number);
    expect(cycle.q[(cycle.count - 1) * cycle.width + block]).toBeCloseTo(0.05, 8);
    expect(cycle.t[cycle.count - 1]).toBeCloseTo(1, 12);
  });

  it("jams when the block is squeezed against the wall, and names what touches", () => {
    const compiled = compile(pushing(40));
    const { cycle, jam } = solveQuasistatic(compiled, [push(compiled, 0.08)]);
    // The block reaches the wall when the pusher is at 70 mm of its 80.
    expect(jam?.time).toBeGreaterThan(0.875);
    expect(jam?.time).toBeLessThan(0.875 + 1 / 40);
    expect(new Set(jam?.rows.map((row) => row.source))).toEqual(new Set(["push", "stop"]));
    const block = 3 * (compiled.bodies.get("block")?.index as number);
    expect(cycle.q[(cycle.count - 1) * cycle.width + block]).toBeCloseTo(0.08, 4);
    expect(cycle.t[cycle.count - 1]).toBeLessThanOrEqual(0.875 + 1e-9);
  });

  it("lets a sprung lever follow a bar down and back up", () => {
    const compiled = compile(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
  lever:
    points: { O: [0, 0] }
    shape: { path: "M 0 -5 H 100 V 5 H 0 Z" }
  bar:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
joints:
  pin: { type: revolute, connect: [ground.O, lever.O] }
pose:
  bar: [75, 15, 0]
springs:
  up: { joint: pin, stiffness: 0.02 N*m/rad, rest: 30 deg }
contacts:
  rest: { between: [lever, bar] }
cycle: { steps: 40 }
`);
    const move: CompiledMove = {
      id: "press",
      body: compiled.bodies.get("bar")?.index as number,
      start: { x: 0.075, y: 0.015, angle: 0 },
      stages: [
        { kind: "to", to: { x: 0.075, y: 0.005, angle: 0 }, time: 1 },
        { kind: "to", to: { x: 0.075, y: 0.015, angle: 0 }, time: 1 },
      ],
    };
    const { cycle, jam } = solveQuasistatic(compiled, [move]);
    expect(jam).toBeUndefined();
    expect(cycle.count).toBe(41);
    const lever = 3 * (compiled.bodies.get("lever")?.index as number);
    const bar = 3 * (compiled.bodies.get("bar")?.index as number);
    for (let k = 0; k < cycle.count; k++) {
      // The lever's top face lies against the bar's lower right corner, 85 mm out.
      const y = cycle.q[k * cycle.width + bar + 1] as number;
      const angle = Math.acos(0.005 / Math.hypot(y, 0.085)) - Math.atan2(0.085, y);
      expect(cycle.q[k * cycle.width + lever + 2]).toBeCloseTo(angle, 8);
    }
    expect(cycle.q[20 * cycle.width + lever + 2]).toBeCloseTo(0, 8);
    expect(cycle.q[40 * cycle.width + lever + 2]).toBeCloseTo(cycle.q[lever + 2] as number, 8);
  });

  it("settles a sprung arm at its spring's rest angle when nothing is driven", () => {
    const compiled = compile(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O] }
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
`);
    const { cycle, jam } = solveQuasistatic(compiled);
    expect(jam).toBeUndefined();
    expect(cycle.count).toBe(1);
    expect(cycle.q[2]).toBeCloseTo(70 * DEG, 5);
  });

  it("gives mekasim's positions where the joints and a motor fix everything", () => {
    const fourBar = readFileSync(
      new URL("../../../examples/four-bar.mekasim.yaml", import.meta.url),
      "utf8",
    ).replace("mekasim: 1", "mekafit: 1");
    const result = simulate(fourBar);
    const compiled = result.compiled as FitCompiled;
    const { cycle, jam } = solveQuasistatic(compiled);
    expect(jam).toBeUndefined();
    const there = result.cycle as NonNullable<typeof result.cycle>;
    expect(cycle.count).toBe(there.count + 1);
    for (let i = 0; i < there.q.length; i++)
      expect(cycle.q[i]).toBeCloseTo(there.q[i] as number, 9);
  });

  it("reports a start that cannot be assembled as mekasim does", () => {
    const { compiled } = simulate(
      `mekafit: 1
bodies:
  ground:
    points: { O: [0, 0], Q: [500, 0] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O] }
  far: { type: revolute, connect: [ground.Q, arm.P] }
`.replace("mekafit: 1", "mekafit: 1\nsprings: {}"),
    );
    const { cycle } = solveQuasistatic(compiled as FitCompiled);
    expect(cycle.count).toBe(0);
    expect(cycle.failure?.step).toBe(0);
  });
});
