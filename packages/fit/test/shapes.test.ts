import { readFileSync } from "node:fs";
import { simulate as simulateModel } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { loopArea, shapeBounds, simulate } from "../src/index.ts";

const shaped = readFileSync(
  new URL("../../../examples/fit/shaped-four-bar.mekafit.yaml", import.meta.url),
  "utf8",
);
const fourBar = readFileSync(
  new URL("../../../examples/four-bar.mekasim.yaml", import.meta.url),
  "utf8",
);

const messages = (text: string) =>
  simulate(text).diagnostics.map((d) => [d.message, d.path?.join("."), d.position?.line]);

describe("shapes on bodies", () => {
  const simulation = simulate(shaped);

  it("are read into outlines in metres, with their holes", () => {
    expect(simulation.diagnostics).toEqual([]);
    expect([...simulation.shapes.keys()]).toEqual(["crank", "coupler", "rocker"]);
    const rocker = simulation.shapes.get("rocker");
    // A bar 110 mm between centres and 18 mm wide, with round ends.
    expect(loopArea(rocker?.outer ?? { segments: [] })).toBeCloseTo(
      (110 * 18 + Math.PI * 81) * 1e-6,
      12,
    );
    expect(rocker?.holes).toHaveLength(2);
    expect(-loopArea(rocker?.holes[1] ?? { segments: [] })).toBeCloseTo(Math.PI * 9e-6, 12);
    expect(rocker?.bounds.maxX).toBeCloseTo(0.119, 12);
    expect(rocker?.radius).toBeCloseTo(0.119, 12);
  });

  it("do not change the motion", () => {
    const plain = simulateModel(fourBar);
    expect(simulation.cycle?.q).toEqual(plain.cycle?.q);
    expect(simulation.checks).toMatchObject([{ id: "swings_enough", holds: true }]);
  });

  it("are not known to mekasim", () => {
    expect(simulateModel(shaped.replace("mekafit: 1", "mekasim: 1")).diagnostics.length).toBe(3);
  });

  it("widen what there is to show", () => {
    const { cycle, compiled, shapes } = simulation;
    if (!cycle || !compiled) throw new Error("the example does not solve");
    const box = shapeBounds({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, cycle, compiled.bodies, shapes);
    // The crank goes all the way round its shaft, 49 mm at its furthest.
    expect(box.minX).toBeLessThanOrEqual(-0.049 + 1e-12);
    expect(box.maxX).toBeGreaterThan(0.18);
  });
});

describe("a shape that is wrong", () => {
  const withPath = (path: string): string =>
    shaped.replace(/path: "M 0 -9 L 110[^"]*"/, `path: "${path}"`);

  it("is reported on its line, in the document's unit", () => {
    expect(messages(withPath("M 0 0 L 110 0 L 110 9"))).toEqual([
      [
        "The outline that starts at (0, 0) is not closed: end it with Z",
        "bodies.rocker.shape.path",
        33,
      ],
    ]);
    expect(messages(withPath("M 0 0 L 110 20 L 110 0 L 0 20 Z"))[0]?.[0]).toBe(
      "The outline crosses itself at (55, 10)",
    );
  });

  it("stops the run, since what it would show is not the part", () => {
    expect(simulate(withPath("M 0 0 L 1 1")).cycle).toBeUndefined();
  });

  it("has its holes on points the body has, with a size", () => {
    expect(
      messages(shaped.replace("holes: { B: pin, O: pin }", "holes: { B: pin, Q: 3 }")),
    ).toEqual([['Body "rocker" has no point "Q"', "bodies.rocker.shape.holes.Q", 34]]);
    expect(
      messages(shaped.replace("holes: { B: pin, O: pin }", "holes: { B: bolt, O: 0 }")).map(
        (m) => m[0],
      ),
    ).toEqual(['Unknown name "bolt" in "bolt"', "A hole's diameter must be more than zero"]);
  });

  it("has its holes inside the outline", () => {
    expect(
      messages(shaped.replace("holes: { B: pin, O: pin }", "holes: { B: 30 }"))[0]?.[0],
    ).toMatch(/^Two outlines cross at /);
  });
});
