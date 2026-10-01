import { describe, expect, it } from "vitest";
import { hullDistance } from "../src/analysis/layers.ts";
import { modelExtent, motionBounds, partSizes, pinDiameters } from "../src/analysis/sizes.ts";
import { buildParts } from "../src/fabricate/parts.ts";
import { simulate } from "../src/simulate.ts";

/** An eccentric shaft with two throws, each driving a rod to a rocker, as on a pair of sieves. */
const ECCENTRICS = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0], G1: [-500, 400], G2: [-500, 150] } }
  shaft: { points: { A: [16, 23], O: [0, 0], C: [-5, -22] } }
  rod_a: { points: { A: [16, 23], B: [-490, 350] } }
  rod_b: { points: { A: [-5, -22], B: [-480, 110] } }
  rocker_a: { points: { B: [-490, 350], G: [-500, 400] } }
  rocker_b: { points: { B: [-480, 110], G: [-500, 150] } }
joints:
  origin: { type: revolute, connect: [ground.O, shaft.O] }
  pin_a: { type: revolute, connect: [shaft.A, rod_a.A] }
  pin_c: { type: revolute, connect: [shaft.C, rod_b.A] }
  end_a: { type: revolute, connect: [rod_a.B, rocker_a.B] }
  end_b: { type: revolute, connect: [rod_b.B, rocker_b.B] }
  hang_a: { type: revolute, connect: [ground.G1, rocker_a.G] }
  hang_b: { type: revolute, connect: [ground.G2, rocker_b.G] }
drivers:
  motor: { joint: origin, speed: 60 }
# Links wider than the throws are long, and pins to match, as a model of a whole
# machine is drawn.
fabrication: { width: 100, hole: 42 }
`;

function layers(text: string): Record<string, number> {
  const bodies = simulate(text).compiled?.bodies ?? new Map();
  return Object.fromEntries(
    [...bodies.values()].filter((b) => b.index >= 0).map((b) => [b.id, b.layer]),
  );
}

describe("hullDistance", () => {
  const square = (x: number, y: number): [number, number][] => [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];

  it("gives the gap between shapes that are apart", () => {
    expect(hullDistance(square(0, 0), square(3, 0))).toBeCloseTo(2, 12);
    expect(hullDistance(square(0, 0), square(2, 2))).toBeCloseTo(Math.SQRT2, 12);
  });

  it("is zero for shapes that cross, touch at a crossing, or lie one inside the other", () => {
    expect(hullDistance(square(0, 0), square(0.5, 0.5))).toBe(0);
    expect(hullDistance(square(0, 0), [[0.4, 0.4]])).toBe(0);
    // Two lines that cross each other.
    expect(
      hullDistance(
        [
          [0, 0],
          [2, 2],
        ],
        [
          [0, 2],
          [2, 0],
        ],
      ),
    ).toBe(0);
  });

  it("takes a link as the line between its two points", () => {
    expect(
      hullDistance(
        [
          [0, 0],
          [10, 0],
        ],
        [
          [5, 3],
          [5, 8],
        ],
      ),
    ).toBeCloseTo(3, 12);
    expect(hullDistance([[0, 0]], [[3, 4]])).toBeCloseTo(5, 12);
  });
});

describe("layers", () => {
  it("keep apart two rods on neighbouring eccentrics, though no joint connects them", () => {
    const placed = layers(ECCENTRICS);
    expect(placed.rod_a).not.toBe(placed.rod_b);
    // Each rod is also apart from the shaft it is pinned to.
    expect(placed.rod_a).not.toBe(placed.shaft);
    expect(placed.rod_b).not.toBe(placed.shaft);
  });

  it("let bodies that never come near each other share a layer", () => {
    const placed = layers(ECCENTRICS);
    expect(placed.rocker_a).toBe(placed.rocker_b);
  });

  it("keep apart links that cross during the motion though they start clear", () => {
    // A crank sweeping over a bar that is fixed nearby: they overlap for part of the turn only.
    const text = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0], P: [60, -30] } }
  crank: { points: { O: [0, 0], A: [0, 100] } }
  bar: { points: { P: [60, -30], Q: [60, 30] } }
joints:
  main: { type: revolute, connect: [ground.O, crank.O] }
  fix: { type: weld, connect: [ground.P, bar.P] }
drivers:
  motor: { joint: main, speed: 60 }
`;
    expect(layers(text)).toEqual({ crank: 0, bar: 1 });
  });

  it("keep a layer that the model gives", () => {
    const text = ECCENTRICS.replace(
      "rod_b: { points: { A: [-5, -22], B: [-480, 110] } }",
      "rod_b: { points: { A: [-5, -22], B: [-480, 110] }, layer: 7 }",
    );
    expect(layers(text).rod_b).toBe(7);
  });
});

describe("pins that crowd", () => {
  const simulation = simulate(ECCENTRICS);
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) throw new Error("not solved");
  const sizes = partSizes(compiled, modelExtent(compiled, motionBounds(compiled, cycle)));
  const nominal = 2 * sizes.pin;
  const pins = pinDiameters(compiled, nominal);
  const of = (id: string) => pins.get(id) as number;

  it("are made smaller, so that pins a short throw apart do not run into each other", () => {
    // The throws are 28 and 22.6 mm from the shaft's centre; the pin asked for is 42 mm.
    expect(nominal).toBeCloseTo(0.042, 12);
    expect(of("pin_a")).toBeCloseTo(0.8 * Math.hypot(16, 23) * 1e-3, 9);
    expect(of("pin_c")).toBeCloseTo(0.8 * Math.hypot(5, 22) * 1e-3, 9);
    // The shaft's own pin has to fit beside the nearer of the two.
    expect(of("origin")).toBeCloseTo(of("pin_c"), 12);
    // Two pins side by side leave a gap between them.
    expect(of("origin") / 2 + of("pin_c") / 2).toBeLessThan(Math.hypot(5, 22) * 1e-3);
  });

  it("take account of every pinned point of both bodies", () => {
    // The rocker is only 51 mm between its pins, which is also less than two pins need.
    expect(of("hang_a")).toBeCloseTo(0.8 * Math.hypot(10, 50) * 1e-3, 9);
  });

  it("stay the size asked for where there is room", () => {
    const small = pinDiameters(compiled, 0.01);
    expect([...small.values()].every((diameter) => diameter === 0.01)).toBe(true);
  });

  it("give holes that do not overlap in the parts", () => {
    const parts = buildParts(simulation, {
      width: 2 * sizes.half,
      thickness: sizes.thickness,
      hole: nominal,
      clearance: 0,
    });
    const shaft = parts.find((p) => p.id === "shaft");
    const holes = shaft?.holes ?? [];
    expect(holes).toHaveLength(3);
    for (const a of holes) {
      for (const b of holes) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan((a.diameter + b.diameter) / 2);
      }
    }
  });
});
