import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics.ts";
import { simulate } from "../src/simulate.ts";

function errors(text: string): Diagnostic[] {
  return simulate(text).diagnostics.filter((d) => d.severity === "error");
}

const FOUR_BAR = `
mekasim: 1
bodies:
  ground: { points: { O2: [0, 0], O4: [180, 0] } }
  crank: { points: { O: [0, 0], A: [40, 0] } }
  coupler: { points: { A: [0, 0], B: [160, 0] } }
  rocker: { points: { B: [0, 0], O: [110, 0] } }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }
  pin_b: { type: revolute, connect: [coupler.B, rocker.B] }
  rock: { type: revolute, connect: [rocker.O, ground.O4] }
pose:
  coupler: [40, 0, 40]
  rocker: [160, 110, -80]
`;

describe("text and schema errors", () => {
  it("reports YAML syntax errors with their line", () => {
    const [error] = errors("mekasim: 1\nbodies:\n  ground: { points: { O: [0, 0 }\n");
    expect(error?.position?.line).toBe(3);
  });

  it("rejects duplicate keys", () => {
    const [error] = errors("mekasim: 1\nbodies:\n  a: { points: {} }\n  a: { points: {} }\n");
    expect(error?.message).toContain("unique");
    expect(error?.position?.line).toBe(4);
  });

  it("rejects an unknown joint type on its line", () => {
    const text = FOUR_BAR.replace(
      "pose:",
      "  extra: { type: hinge, connect: [ground.O2, crank.O] }\npose:",
    );
    const [error] = errors(text);
    expect(error?.path).toEqual(["joints", "extra", "type"]);
    expect(error?.position?.line).toBe(
      text.split("\n").findIndex((line) => line.includes("extra")) + 1,
    );
  });

  it("rejects unknown keys", () => {
    const [error] = errors("mekasim: 1\nbodies: {}\nlinks: {}\n");
    expect(error?.message).toContain('"links"');
  });

  it("accepts JSON", () => {
    const text = JSON.stringify({ mekasim: 1, bodies: { ground: { points: { O: [0, 0] } } } });
    expect(simulate(text).diagnostics).toEqual([]);
  });
});

describe("model errors", () => {
  it("reports an unknown point where it is used", () => {
    const [error] = errors(FOUR_BAR.replace("crank.A, coupler.A", "crank.Z, coupler.A"));
    expect(error?.message).toBe('Body "crank" has no point "Z"');
    expect(error?.path).toEqual(["joints", "pin_a", "connect", 0]);
    expect(error?.position?.line).toBe(10);
  });

  it("reports an unknown parameter once, however often it is used", () => {
    const text = FOUR_BAR.replace("A: [40, 0]", "A: [r, 0]");
    const found = errors(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe('Unknown parameter "r" in "r"');
  });

  it("reports parameters that depend on each other", () => {
    const text = `${FOUR_BAR}params: { a: b + 1, b: a * 2 }\n`;
    expect(errors(text).map((e) => e.message)).toEqual([
      'Parameter "a" depends on itself in "a * 2"',
    ]);
  });

  it("reports a wrong kind of quantity", () => {
    const [error] = errors(FOUR_BAR.replace("A: [40, 0]", "A: [40 deg, 0]"));
    expect(error?.message).toBe("Expected a length, got an angle");
  });

  it("rejects a joint within one body", () => {
    const [error] = errors(FOUR_BAR.replace("crank.A, coupler.A", "crank.A, crank.O"));
    expect(error?.message).toBe("A joint must connect two different bodies");
  });

  it("only lets revolute joints be driven", () => {
    const text = `${FOUR_BAR}drivers:\n  motor: { joint: nothing, speed: 60 }\n`;
    expect(errors(text)[0]?.message).toBe('Unknown joint "nothing"');
  });

  it("reports a mistake in a measure", () => {
    const text = `${FOUR_BAR}measures:\n  bad: x(coupler.Q)\n  worse: 2 * coupler.B\n`;
    expect(errors(text).map((e) => e.message)).toEqual([
      'Body "coupler" has no point "Q"',
      'Unknown name "coupler.B"; wrap it in a function such as x() or angle()',
    ]);
  });
});

describe("mechanism diagnostics", () => {
  it("solves only the starting position when nothing is driven", () => {
    const simulation = simulate(FOUR_BAR);
    expect(simulation.cycle?.count).toBe(1);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 1 });
    expect(simulation.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message:
          "1 degree of freedom and no driver: only the starting position is solved. Add a driver to see motion",
      }),
    ]);
  });

  it("names the bodies left free by too few drivers", () => {
    // A five-bar needs two drivers; with one, everything past the crank is loose.
    const text = `
mekasim: 1
bodies:
  ground: { points: { A: [0, 0], E: [100, 0] } }
  l1: { points: { A: [0, 0], B: [0, 60] } }
  l2: { points: { B: [0, 60], C: [50, 110] } }
  l3: { points: { C: [50, 110], D: [100, 60] } }
  l4: { points: { D: [100, 60], E: [100, 0] } }
joints:
  a: { type: revolute, connect: [ground.A, l1.A] }
  b: { type: revolute, connect: [l1.B, l2.B] }
  c: { type: revolute, connect: [l2.C, l3.C] }
  d: { type: revolute, connect: [l3.D, l4.D] }
  e: { type: revolute, connect: [l4.E, ground.E] }
drivers:
  motor: { joint: a, speed: 10 }
cycle: { steps: 12, revolutions: 0.05 }
`;
    const simulation = simulate(text);
    expect(simulation.mobility).toMatchObject({ mobility: 2, free: 1 });
    expect(simulation.mobility?.freeBodies.sort()).toEqual(["l2", "l3", "l4"]);
    expect(simulation.diagnostics[0]?.severity).toBe("warning");
  });

  it("notes redundant constraints without failing", () => {
    // A third parallel arm on a parallelogram adds nothing.
    const text = `
mekasim: 1
bodies:
  ground: { points: { A: [0, 0], B: [100, 0], C: [200, 0] } }
  arm1: { points: { G: [0, 0], T: [0, 50] } }
  arm2: { points: { G: [100, 0], T: [100, 50] } }
  arm3: { points: { G: [200, 0], T: [200, 50] } }
  bar: { points: { A: [0, 50], B: [100, 50], C: [200, 50] } }
joints:
  g1: { type: revolute, connect: [ground.A, arm1.G] }
  g2: { type: revolute, connect: [ground.B, arm2.G] }
  g3: { type: revolute, connect: [ground.C, arm3.G] }
  t1: { type: revolute, connect: [arm1.T, bar.A] }
  t2: { type: revolute, connect: [arm2.T, bar.B] }
  t3: { type: revolute, connect: [arm3.T, bar.C] }
drivers:
  motor: { joint: g1, speed: 10 }
cycle: { steps: 36, revolutions: 0.1 }
`;
    const simulation = simulate(text);
    expect(simulation.cycle?.count).toBe(36);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0, redundant: 1 });
    expect(simulation.diagnostics.map((d) => d.severity)).toEqual(["info"]);
  });

  it("explains a mechanism that cannot be assembled", () => {
    const text = FOUR_BAR.replace("B: [160, 0]", "B: [20, 0]");
    const [error] = errors(text);
    expect(error?.message).toMatch(
      /^The mechanism cannot be assembled from its starting position; cannot close /,
    );
    expect(simulate(text).cycle?.count).toBe(0);
  });

  it("explains a crank that cannot go all the way round", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { O2: [0, 0], O4: [180, 0] } }
  crank: { points: { O: [0, 0], A: [100, 0] } }
  coupler: { points: { A: [100, 0], B: [140, 44.72136] } }
  rocker: { points: { B: [140, 44.72136], O: [180, 0] } }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }
  pin_b: { type: revolute, connect: [coupler.B, rocker.B] }
  rock: { type: revolute, connect: [rocker.O, ground.O4] }
drivers:
  motor: { joint: main, speed: 60 }
`;
    const simulation = simulate(text);
    const [error] = simulation.diagnostics.filter((d) => d.severity === "error");
    expect(error?.message).toMatch(/^The mechanism locks up at step \d+ of 360/);
    const solved = simulation.cycle?.count ?? 0;
    expect(solved).toBeGreaterThan(10);
    expect(solved).toBeLessThan(180);
  });

  it("flags a driver on a structure that cannot move", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { A: [0, 0], B: [100, 0] } }
  left: { points: { A: [0, 0], C: [50, 80] } }
  right: { points: { B: [100, 0], C: [50, 80] } }
joints:
  a: { type: revolute, connect: [ground.A, left.A] }
  b: { type: revolute, connect: [ground.B, right.B] }
  c: { type: revolute, connect: [left.C, right.C] }
drivers:
  motor: { joint: a, speed: 60 }
`;
    const found = errors(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('Driver "motor" has nothing to move');
  });
});

describe("joint types", () => {
  it("keeps a slider block square to its guide", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0], P: [0, 30], Q: [100, 30] } }
  crank: { points: { O: [0, 0], A: [0, 20] } }
  rod: { points: { A: [0, 20], B: [80, 30] } }
  block: { points: { B: [80, 30], Top: [80, 40] } }
joints:
  main: { type: revolute, connect: [ground.O, crank.O] }
  pin: { type: revolute, connect: [crank.A, rod.A] }
  wrist: { type: revolute, connect: [rod.B, block.B] }
  guide: { type: slider, axis: [ground.P, ground.Q], point: block.B }
drivers:
  motor: { joint: main, speed: 60 }
measures:
  tilt: range(angle(block))
  rise: range(y(block.Top))
  stroke: range(x(block.B))
`;
    const simulation = simulate(text);
    expect(simulation.diagnostics).toEqual([]);
    const value = (id: string): number =>
      simulation.measures.find((m) => m.id === id)?.quantity?.value as number;
    expect(value("tilt")).toBeCloseTo(0, 10);
    expect(value("rise")).toBeCloseTo(0, 10);
    expect(value("stroke")).toBeGreaterThan(0.03);
  });

  it("holds welded bodies together as one", () => {
    const text = `
mekasim: 1
bodies:
  ground: { points: { O: [0, 0] } }
  crank: { points: { O: [0, 0], A: [50, 0] } }
  flag: { points: { A: [0, 0], Tip: [0, 20] } }
joints:
  main: { type: revolute, connect: [ground.O, crank.O] }
  fix: { type: weld, connect: [crank.A, flag.A], angle: 90 }
drivers:
  motor: { joint: main, speed: 60 }
measures:
  reach: max(dist(ground.O, flag.Tip)) - min(dist(ground.O, flag.Tip))
  radius: mean(dist(ground.O, flag.Tip))
`;
    const simulation = simulate(text);
    expect(simulation.diagnostics).toEqual([]);
    const value = (id: string): number =>
      simulation.measures.find((m) => m.id === id)?.quantity?.value as number;
    expect(value("reach")).toBeCloseTo(0, 10);
    // Welded at 90 degrees, the flag points back along the crank: 50 - 20 mm from the centre.
    expect(value("radius")).toBeCloseTo(0.03, 10);
  });
});
