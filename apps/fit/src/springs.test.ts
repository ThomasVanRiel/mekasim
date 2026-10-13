import { simulate } from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import { holdsAt, loadText, locksAt } from "./springs.ts";

const model = `mekafit: 1
bodies:
  ground:
    points: { A: [0, 0], B: [100, 0], O: [0, 50] }
  ram:
    points: { P: [0, 0] }
  arm:
    points: { O: [0, 0] }
joints:
  guide: { type: slider, axis: [ground.A, ground.B], point: ram.P, stops: [0, 60 mm] }
  pin: { type: revolute, connect: [ground.O, arm.O], stops: [null, 45 deg] }
pose:
  ram: [40, 0, 0]
  arm: [0, 50, 0]
springs:
  back: { connect: [ground.A, ram.P], stiffness: 2 N/mm, length: 40 }
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
drivers:
  tug:
    move: ram
    stages:
      - { pull: [100 N, 0], time: 1 }
      - { pull: [0, 0], time: 1 }
latches:
  catch: { joint: guide, at: 50 mm, drops: up }
cycle: { steps: 10 }
`;

describe("the Springs and locks fold", () => {
  const simulation = simulate(model);
  const last = (simulation.cycle?.count ?? 1) - 1;

  it("says what each spring, stop and lock is, in the model's units", () => {
    const { springs, stops, locks } = holdsAt(simulation, 0);
    expect(springs.map(({ name, about }) => [name, about])).toEqual([
      ["back", "2 N/mm, 40 mm long at rest"],
      ["opener", "0.349 N·mm/deg on pin, at rest at 70 deg"],
    ]);
    expect(stops.map(({ name, about }) => [name, about])).toEqual([
      ["guide", "Between 0 mm and 60 mm"],
      ["pin", "No more than 45 deg"],
    ]);
    expect(locks.map(({ name, about }) => [name, about])).toEqual([
      ["catch", "Drops in behind guide at 50 mm"],
    ]);
  });

  it("says how each stands at the shown step", () => {
    const start = holdsAt(simulation, 0);
    expect(start.springs.map(({ now }) => now)).toEqual(["At rest", "Turning with 8.73 N·mm"]);
    expect(start.stops.map(({ now }) => now)).toEqual([
      "Clear of its stops",
      "Against its stop with 8.73 N·mm",
    ]);
    expect(start.locks[0]?.now).toBe("Out");

    // Pulled out to the stop at 60 mm: the spring takes 40 N of the 100, the stop the rest.
    const pulled = holdsAt(simulation, simulation.cycle?.t.indexOf(1) ?? 0);
    expect(pulled.springs[0]?.now).toBe("Pulling with 40 N");
    expect(pulled.stops[0]?.now).toBe("Against its stop with 60 N");
    expect(pulled.locks[0]?.now).toBe("In");

    // Let go, the spring brings the ram back onto the lock.
    const end = holdsAt(simulation, last);
    expect(end.springs[0]?.now).toBe("Pulling with 20 N");
    expect(end.locks[0]?.now).toBe("In, holding 20 N");
  });

  it("keeps to the run where the step is beside it, and is empty without one", () => {
    expect(holdsAt(simulation, 999).locks[0]?.now).toBe("In, holding 20 N");
    expect(holdsAt(simulation, 2.4)).toEqual(holdsAt(simulation, 2));
    expect(holdsAt(undefined, 0)).toEqual({ springs: [], stops: [], locks: [] });
  });

  it("gives the sheet each lock's joint and whether it is in", () => {
    expect(locksAt(simulation, 0)).toEqual([{ id: "catch", joint: "guide", in: false }]);
    expect(locksAt(simulation, last)).toEqual([{ id: "catch", joint: "guide", in: true }]);
    expect(locksAt(undefined, 0)).toEqual([]);
  });

  it("writes a torque in newton metres where the model is not in millimetres", () => {
    expect(loadText(0.5, true, { length: "m", angle: "rad" })).toBe("0.5 N·m");
    expect(loadText(0.5, true, { length: "mm", angle: "deg" })).toBe("500 N·mm");
    expect(loadText(12.345, false, { length: "mm", angle: "deg" })).toBe("12.3 N");
  });
});
