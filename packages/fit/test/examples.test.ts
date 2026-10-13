import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";

const DIRECTORY = new URL("../../../examples/fit/", import.meta.url);
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith(".mekafit.yaml"));
const read = (file: string): string => readFileSync(new URL(file, DIRECTORY), "utf8");

describe("mekafit's examples", () => {
  for (const file of files) {
    it(`solves ${file}`, () => {
      const result = simulate(read(file));
      expect(result.diagnostics).toEqual([]);
      expect(result.cycle?.count).toBeGreaterThan(1);
      expect(result.checks.every(({ holds }) => holds)).toBe(true);
    });
  }

  it("has a sprung lever that gives way under a bar and follows it back", () => {
    const result = simulate(read("sprung-lever.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    // Flat under the bar at its lowest; at its highest the bar's corner is 15 mm up, 85 mm out.
    expect(value("lowest")).toBeCloseTo(0, 8);
    expect(value("highest")).toBeCloseTo(
      Math.acos(0.005 / Math.hypot(0.015, 0.085)) - Math.atan2(0.085, 0.015),
      8,
    );
    expect(result.cycle?.count).toBe(81);
  });

  it("has a door latch whose bolt is pushed back by the strike and then holds the door", () => {
    const result = simulate(read("door-latch.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    // The strike's corner rides the 45 degree slant of the nose for its 8 mm of height.
    expect(value("furthest_in")).toBeCloseTo(-0.008, 8);
    // Pulled with 20 N, the door is held by the bolt's back on the strike with the same.
    expect(value("holding")).toBeCloseTo(20, 5);
    expect(result.free).toEqual([]);
    const { cycle, compiled } = result;
    const door = 3 * (compiled?.bodies.get("door")?.index as number);
    expect(cycle?.q[((cycle?.count ?? 1) - 1) * cycle.width + door]).toBeCloseTo(0.07, 8);
  });

  it("has a ratchet whose pawl drops behind two teeth and then holds the wheel", () => {
    const result = simulate(read("ratchet.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    const pawl = value("pawl") as Float64Array;
    const wheel = value("wheel") as Float64Array;
    // The pawl rides up each tooth and falls off its end: twice in 100 degrees of 45 degree teeth.
    let drops = 0;
    for (let k = 1; k < pawl.length; k++) {
      if ((pawl[k] as number) - (pawl[k - 1] as number) < -0.05) drops++;
    }
    expect(drops).toBe(2);
    // Let go, the wheel comes back until the tooth it last passed, 90 degrees round, meets the pawl.
    const end = ((wheel.at(-1) as number) * 180) / Math.PI;
    expect(end).toBeGreaterThan(-86);
    expect(end).toBeLessThan(-84);
    expect(wheel.at(-1)).toBeCloseTo(wheel.at(-20) as number, 9);
    expect(value("holding")).toBeGreaterThan(2);
    expect(result.free).toEqual([]);
  });

  it("has a knuckle coupler that is swung shut, locks, and holds against a pull", () => {
    const result = simulate(read("knuckle-coupler.mekafit.yaml"));
    const value = (id: string) => result.measures.find((m) => m.id === id)?.quantity?.value;
    const knuckle = value("knuckle") as Float64Array;
    // Open at 45 degrees until the other nose strikes its tail; shut once pushed home.
    expect(knuckle[0]).toBeCloseTo(Math.PI / 4, 9);
    expect(Math.min(...knuckle)).toBeCloseTo(0, 6);
    // The lock is out until then and in ever after, and the other was in from the start.
    const lock = result.latched.lock_a as Float64Array;
    expect(lock[0]).toBe(0);
    expect(lock.at(-1)).toBe(1);
    expect(Array.from(result.latched.lock_b as Float64Array).every((v) => v === 1)).toBe(true);
    // Pulled apart, the noses hook after a few millimetres and both locks carry the pull.
    expect(value("slack")).toBeGreaterThan(0.004);
    expect(value("slack")).toBeLessThan(0.007);
    expect(result.loads?.locks.lock_a?.at(-1)).toBeGreaterThan(0.5);
    expect(result.loads?.locks.lock_b?.at(-1)).toBeGreaterThan(0.5);
    expect(result.loads?.contacts.knuckles?.at(-1)).toBeGreaterThan(100);
    expect(result.free).toEqual([]);
  });

  it("jams the couplers when both knuckles are shut, and names them", () => {
    const shut = read("knuckle-coupler.mekafit.yaml")
      .replace("knuckle_a: [-22, 20, open]", "knuckle_a: [-22, 20, 0]")
      .replace(
        "lock_a: { joint: pin_a, at: 2 deg, drops: down }",
        "lock_a: { joint: pin_a, at: 2 deg, drops: down, engaged: true }",
      );
    const errors = simulate(shut).diagnostics.filter(({ severity }) => severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/^Jams at [\d.]+ s: .*"knuckle_a" against "knuckle_b"/);
  });

  it("has a push latch that stays in after one push and comes out after the next", () => {
    const result = simulate(read("push-latch.mekafit.yaml"));
    const cycle = result.cycle as NonNullable<typeof result.cycle>;
    const value = (id: string) =>
      result.measures.find((m) => m.id === id)?.quantity?.value as Float64Array;
    const drawer = value("in");
    const pin = value("pin");
    const at = (t: number) => cycle.t.findIndex((time) => time >= t - 1e-9);
    // Pushed 45 mm in, the pin has gone down the right of the heart.
    expect(drawer[at(1)]).toBeCloseTo(0.045, 9);
    expect(pin[at(1)]).toBeGreaterThan(0.012);
    // Let go, the drawer comes back only as far as the cleft, and stays there.
    expect(drawer[at(2)]).toBeGreaterThan(0.025);
    expect(drawer[at(2)]).toBeLessThan(0.033);
    expect(drawer[at(2)]).toBeCloseTo(drawer[at(1.6)] as number, 8);
    expect(result.loads?.contacts.island?.[at(2)]).toBeGreaterThan(1);
    // Pushed again, the pin goes down the left; let go, the drawer comes all the way out.
    expect(pin[at(3)]).toBeLessThan(-0.003);
    expect(drawer.at(-1)).toBeCloseTo(0, 9);
    // And the pin is back at the top, to the right of the heart's point for the next push.
    expect(pin.at(-1)).toBeGreaterThan(-0.008);
    expect(pin.at(-1)).toBeLessThan(0.003);
    expect(result.free).toEqual([]);
  });

  it("has a motor-driven clearance check with its hand-worked closest gap", () => {
    const result = simulate(read("clearance-check.mekafit.yaml"));
    const tightest = result.measures.find(({ id }) => id === "tightest")?.quantity?.value;
    expect(tightest).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.smallest.distance).toBeCloseTo(0.003, 12);
    expect(result.contacts[0]?.step).toBe(36);
  });
});
