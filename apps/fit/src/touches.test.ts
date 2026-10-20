import { simulate } from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import { touchesAt } from "./touches.ts";

/** A lever held up against a bar by a spring; the bar comes down 10 mm and goes back. */
const model = `mekafit: 1
meta:
  units: { length: mm, angle: deg }
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
drivers:
  press:
    move: bar
    stages:
      - { to: [75, 5, 0], time: 1 }
      - { to: [75, 15, 0], time: 1 }
springs:
  up: { joint: pin, stiffness: 0.02 N*m/rad, rest: 30 deg }
contacts:
  rest: { between: [lever, bar] }
cycle: { steps: 20 }
`;

describe("where the parts touch, on the sheet", () => {
  const simulation = simulate(model);

  it("puts each place on the lever's top face, where the bar bears on it", () => {
    const first = touchesAt(simulation, 0);
    expect(first).toHaveLength(1);
    expect(first[0]?.body).toBe("lever");
    expect(first[0]?.v).toBeCloseTo(0.005, 6);
    // Pressed flat, both ends of the bar's lower face, at 75 and 85 mm.
    const flat = touchesAt(simulation, 10);
    expect(flat.map(({ u }) => u).sort()).toEqual([
      expect.closeTo(0.075, 6),
      expect.closeTo(0.085, 6),
    ]);
  });

  it("sizes each by the hardest press of the run, and says how hard in the model's units", () => {
    const shares = Array.from({ length: 21 }, (_, k) => touchesAt(simulation, k))
      .flat()
      .map(({ share }) => share);
    expect(Math.max(...shares)).toBeCloseTo(1, 12);
    expect(Math.min(...shares)).toBeGreaterThan(0);
    const force = simulation.touches[0]?.[0]?.force as number;
    expect(touchesAt(simulation, 0)[0]?.text).toBe(
      `lever on bar: ${Number(force.toPrecision(3))} N`,
    );
  });

  it("follows the step shown, and shows nothing without a contact run", () => {
    expect(touchesAt(simulation, 0.4)).toEqual(touchesAt(simulation, 0));
    expect(touchesAt(simulation, 99)).toEqual(touchesAt(simulation, 20));
    expect(touchesAt(undefined, 0)).toEqual([]);
  });
});
