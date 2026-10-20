import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";

const DEG = Math.PI / 180;

/** The values of a model's measures by name, with no errors in the model. */
function measured(text: string): Record<string, number | Float64Array> {
  const result = simulate(text);
  expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  return Object.fromEntries(
    result.measures.map(({ id, quantity }) => [id, quantity?.value as number | Float64Array]),
  );
}

function errors(text: string): string[] {
  return simulate(text)
    .diagnostics.filter(({ severity }) => severity === "error")
    .map(({ message }) => message);
}

/** A ram on a slide along x, 40 mm out, on a spring back to the start of the slide. */
const ram = (rest: string) => `mekafit: 1
bodies:
  ground:
    points: { A: [0, 0], B: [100, 0] }
  ram:
    points: { P: [0, 0] }
joints:
  guide: { type: slider, axis: [ground.A, ground.B], point: ram.P }
pose:
  ram: [40, 0, 0]
springs:
  back: { connect: [ground.A, ram.P], stiffness: 2 N/mm, length: 40 }
cycle: { steps: 10 }
${rest}`;

/** A lever held up against a bar by a spring; the bar comes down 10 mm and goes back. */
const lever = (measures: string) => `mekafit: 1
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
measures:
${measures}
`;

describe("forces from the balance of the parts", () => {
  it("gives a spring that holds a pulled body the pull's force", () => {
    const found = measured(
      ram(`drivers:
  tug:
    move: ram
    stages:
      - { pull: [10 N, 0], time: 1 }
measures:
  spring: force(back)
  pull: force(tug)
  end: final(force(back))
  start: first(force(back))
`),
    );
    const spring = found.spring as Float64Array;
    expect(spring).toHaveLength(11);
    expect(spring[0]).toBeCloseTo(0, 9);
    expect(spring[10]).toBeCloseTo(10, 6);
    expect(Array.from(found.pull as Float64Array).every((value) => value === 10)).toBe(true);
    expect(found.end).toBeCloseTo(10, 6);
    expect(found.start).toBeCloseTo(0, 9);
  });

  it("gives a driver that holds a body against a spring the spring's force", () => {
    const found = measured(
      ram(`drivers:
  tug:
    move: ram
    stages:
      - { to: [55, 0, 0], time: 1 }
measures:
  spring: final(force(back))
  hold: final(force(tug))
  turn: final(torque(tug))
`),
    );
    // 15 mm of stretch on 2 N/mm.
    expect(found.spring).toBeCloseTo(30, 9);
    expect(found.hold).toBeCloseTo(30, 9);
    expect(found.turn).toBeCloseTo(0, 9);
  });

  it("gives the contact of a lever on a bar the force that balances its spring", () => {
    const found = measured(
      lever(`  contact: force(rest)
  spring: torque(up)
  press: force(press)
  angle: angle(lever)`),
    );
    const contact = found.contact as Float64Array;
    const spring = found.spring as Float64Array;
    const press = found.press as Float64Array;
    const angle = found.angle as Float64Array;
    for (let k = 0; k < contact.length; k++) {
      const theta = angle[k] as number;
      // The spring turns the lever up with what is left of its 30 degrees.
      expect(spring[k]).toBeCloseTo(0.02 * (30 * DEG - theta), 9);
      // The bar's corner, 85 mm out, bears on the lever's top face, square to it.
      const y = 0.015 - 0.01 * (k <= 10 ? k / 10 : 2 - k / 10);
      // Pressed flat, the bar's whole lower face bears. How its ends at 75 and 85 mm share
      // that is not settled by their balance; they are given the least forces that hold.
      const flat = (0.075 ** 2 + 0.085 ** 2) / (0.075 + 0.085);
      const arm = k === 10 ? flat : 0.085 * Math.cos(theta) + y * Math.sin(theta);
      expect(contact[k]).toBeCloseTo((spring[k] as number) / arm, 6);
      // And the driver holds the bar against just that.
      expect(press[k]).toBeCloseTo(contact[k] as number, 6);
    }
    expect(contact[10]).toBeGreaterThan(contact[0] as number);
  });

  it("keeps where the lever and the bar touch, on each, and how hard", () => {
    const result = simulate(lever("  angle: angle(lever)"));
    const angle = result.measures.find(({ id }) => id === "angle")?.quantity?.value as Float64Array;
    const contact = result.loads?.contacts.rest as Float64Array;
    expect(result.touches).toHaveLength(angle.length);
    result.touches.forEach((touches, k) => {
      const theta = angle[k] as number;
      const y = 0.015 - 0.01 * (k <= 10 ? k / 10 : 2 - k / 10);
      // Pressed flat, the two ends of the bar's lower face, sharing the force as their
      // distances out; otherwise its far corner alone, on the lever's top face.
      const places =
        k === 10
          ? [
              [0.075, 0],
              [0.085, 0.01],
            ]
          : [[0.085 * Math.cos(theta) + y * Math.sin(theta), 0.01]];
      expect(touches).toHaveLength(places.length);
      const sorted = [...touches].sort((p, q) => p.places[0][0] - q.places[0][0]);
      sorted.forEach((touch, i) => {
        const [out, along] = places[i] as [number, number];
        expect(touch.contact).toBe("rest");
        expect(touch.between).toEqual(["lever", "bar"]);
        expect(touch.places[0][0]).toBeCloseTo(out, 6);
        expect(touch.places[0][1]).toBeCloseTo(0.005, 6);
        expect(touch.places[1][0]).toBeCloseTo(along, 6);
        expect(touch.places[1][1]).toBeCloseTo(0, 6);
        const share = k === 10 ? out / (0.075 + 0.085) : 1;
        expect(touch.force).toBeCloseTo((contact[k] as number) * share, 6);
      });
    });
  });

  it("shares the force of two flat faces between their two ends", () => {
    const found = measured(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
    shape: { path: "M 100 -20 H 110 V 40 H 100 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 20 V 20 H 0 Z" }
pose:
  block: [30, 0, 0]
drivers:
  shove:
    move: block
    stages:
      - { pull: [5 N, 0], time: 1 }
contacts:
  stop: { between: [block, ground] }
cycle: { steps: 20 }
measures:
  wall: final(force(stop))
  before: first(force(stop))
`);
    expect(found.wall).toBeCloseTo(5, 6);
    expect(found.before).toBe(0);
  });

  it("keeps how hard a stop and a lock are held with the run", () => {
    const result = simulate(
      ram(`drivers:
  tug:
    move: ram
    stages:
      - { pull: [100 N, 0], time: 1 }
      - { pull: [0, 0], time: 1 }
latches:
  catch: { joint: guide, at: 50 mm, drops: up }
measures:
  in: latched(catch)
  held: final(latched(catch))
`).replace("point: ram.P }", "point: ram.P, stops: [0, 60 mm] }"),
    );
    expect(result.diagnostics).toEqual([]);
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    const half = cycle.t.indexOf(1);
    // 100 N against a spring stretched 20 mm at the stop: the stop takes the other 60 N.
    expect(result.loads?.stops.guide?.[half]).toBeCloseTo(60, 6);
    // Let go, the spring pulls the ram back onto the lock with its 10 mm of stretch.
    expect(result.loads?.locks.catch?.[cycle.count - 1]).toBeCloseTo(20, 6);
    expect(result.loads?.stops.guide?.[cycle.count - 1]).toBe(0);
    const values = Object.fromEntries(result.measures.map((m) => [m.id, m.quantity?.value]));
    expect(values.held).toBe(1);
    expect((values.in as Float64Array)[0]).toBe(0);
  });

  it("gives the torque a stop takes from a spring, and a motor its torque", () => {
    const result = simulate(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O], stops: [0 deg, 45 deg] }
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
measures:
  spring: torque(opener)
`);
    expect(result.diagnostics).toEqual([]);
    const spring = result.measures[0]?.quantity?.value as Float64Array;
    expect(spring[0]).toBeCloseTo(0.02 * 25 * DEG, 9);
    expect(result.loads?.stops.pin?.[0]).toBeCloseTo(0.02 * 25 * DEG, 9);

    const driven = measured(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
  arm:
    points: { O: [0, 0], P: [100, 0] }
joints:
  pin: { type: revolute, connect: [ground.O, arm.O] }
drivers:
  motor: { joint: pin, speed: 10 rpm }
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 0 deg }
cycle: { steps: 8 }
measures:
  motor: torque(motor)
  spring: torque(opener)
`);
    // A quarter of a turn on, the motor holds the arm against the spring's quarter turn.
    expect((driven.motor as Float64Array)[2]).toBeCloseTo(0.02 * (Math.PI / 2), 9);
    expect((driven.spring as Float64Array)[2]).toBeCloseTo(-0.02 * (Math.PI / 2), 9);
  });
});

describe("mekafit's measures", () => {
  const asking = (measure: string) =>
    errors(lever(`  asked: ${measure}`).replace("  rest: { between", "  up: { between"));

  it("say which of force and torque a thing has", () => {
    expect(errors(lever("  asked: force(up)"))).toEqual([
      '"up" turns a joint, so it has a torque: torque(up)',
    ]);
    expect(errors(lever("  asked: torque(rest)"))).toEqual([
      '"rest" pushes or pulls in a line, so it has a force: force(rest)',
    ]);
    expect(errors(lever("  asked: force(lever)"))).toEqual([
      'Unknown contact, spring or driver "lever"',
    ]);
    expect(errors(lever("  asked: force(2 * 3)"))).toEqual([
      "force() takes the name of a contact, a spring or a driver",
    ]);
    expect(errors(lever("  asked: latched(pin)"))).toEqual(['Unknown lock "pin"']);
    expect(errors(lever("  asked: final(1, 2)"))).toEqual(["final() takes 1 argument, got 2"]);
  });

  it("will not guess between two things of one name", () => {
    expect(asking("torque(up)")).toEqual([
      '"up" is a contact and a spring; give them different names to ask about one',
    ]);
  });

  it("take the last and the first of anything that varies, and leave a number as it is", () => {
    const found = measured(
      lever(`  last: final(angle(lever))
  first: first(angle(lever))
  lowest: final(min(angle(lever)))
  ok: final(gap(lever, bar)) > -0.001 mm`),
    );
    expect(found.last).toBeCloseTo(found.first as number, 8);
    expect(found.lowest).toBeCloseTo(0, 8);
  });

  it("give no force where nothing pushes: a model that mekasim's own solve runs", () => {
    const found = measured(`mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
    shape: { path: "M 100 -20 H 110 V 40 H 100 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 20 V 20 H 0 Z" }
contacts:
  stop: { between: [block, ground] }
measures:
  wall: force(stop)
`);
    expect(Array.from(found.wall as Float64Array)).toEqual([0]);
  });

  it("say so when forces are asked for and nothing pushes", () => {
    const remark = (text: string) =>
      simulate(text)
        .diagnostics.filter(({ severity }) => severity === "info")
        .map(({ message }) => message);
    const dry = lever("  contact: force(rest)").replace(/springs:\n.*\n/, "");
    expect(remark(dry)).toEqual([
      "Every force here is zero: nothing in the model pushes. Forces come from a spring or from a pull",
    ]);
    expect(remark(lever("  contact: force(rest)"))).toEqual([]);
    expect(remark(dry.replace("force(rest)", "angle(lever)"))).toEqual([]);
  });

  it("are not mekasim's", async () => {
    const { simulate: simulateModel } = await import("@mekasim/core");
    const text = lever("  asked: final(angle(lever))")
      .replace("mekafit: 1", "mekasim: 1")
      .replace(/drivers:[\s\S]*cycle:/, "cycle:");
    expect(simulateModel(text).diagnostics.some(({ message }) => message.includes("final"))).toBe(
      true,
    );
  });
});
