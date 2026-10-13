import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { motionBounds } from "../src/analysis/sizes.ts";
import { toDxf } from "../src/fabricate/dxf.ts";
import { buildParts, layoutParts } from "../src/fabricate/parts.ts";
import { loopArea } from "../src/geometry/shape.ts";
import { simulate } from "../src/simulate.ts";

const shaped = readFileSync(
  new URL("../../../examples/shaped-four-bar.mekasim.yaml", import.meta.url),
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
    const bodies = simulation.compiled?.bodies;
    expect([...(bodies?.values() ?? [])].filter((b) => b.shape).map((b) => b.id)).toEqual([
      "crank",
      "coupler",
      "rocker",
    ]);
    const rocker = bodies?.get("rocker")?.shape;
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
    const plain = simulate(fourBar);
    expect(simulation.cycle?.q).toEqual(plain.cycle?.q);
    expect(simulation.checks).toMatchObject([{ id: "swings_enough", holds: true }]);
  });

  it("widen what the motion reaches", () => {
    const { cycle, compiled } = simulation;
    if (!cycle || !compiled) throw new Error("the example does not solve");
    const box = motionBounds(compiled, cycle);
    // The crank goes all the way round its shaft, 49 mm at its furthest.
    expect(box.minX).toBeLessThanOrEqual(-0.049 + 1e-12);
    expect(box.minY).toBeLessThanOrEqual(-0.049 + 1e-12);
  });

  it("are the parts to make, as drawn, with nothing added", () => {
    const parts = buildParts(simulation, {
      width: 0.02,
      thickness: 0.003,
      hole: 0.004,
      clearance: 0.0002,
    });
    const rocker = parts.find((part) => part.id === "rocker");
    expect(rocker?.holes).toEqual([]);
    expect(rocker?.slots).toEqual([]);
    expect(rocker?.cutouts).toHaveLength(2);
    const xs = rocker?.outline.map((p) => p[0]) ?? [];
    expect(Math.max(...xs)).toBeCloseTo(0.119, 9);
    // The ground has no shape, and is still a base plate with its holes.
    expect(parts.find((part) => part.id === "ground")?.holes).toHaveLength(2);
    expect(
      toDxf(
        layoutParts(parts, 0.005),
        simulation.compiled?.units ?? { length: "mm", angle: "deg" },
      ),
    ).toContain("holes");
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
        34,
      ],
    ]);
    expect(messages(withPath("M 0 0 L 110 20 L 110 0 L 0 20 Z"))[0]?.[0]).toBe(
      "The outline crosses itself at (55, 10)",
    );
  });

  it("stops the run, since what it would show is not the part", () => {
    expect(simulate(withPath("M 0 0 L 1 1")).cycle).toBeUndefined();
  });

  it("is an unknown name to nobody: a parameter can size a hole", () => {
    const bigger = simulate(shaped.replace("pin: 6 mm", "pin: 8 mm"));
    const hole = bigger.compiled?.bodies.get("rocker")?.shape?.holes[0];
    expect(-loopArea(hole ?? { segments: [] })).toBeCloseTo(Math.PI * 16e-6, 12);
  });

  it("has its holes on points the body has, with a size", () => {
    expect(
      messages(shaped.replace("holes: { B: pin, O: pin }", "holes: { B: pin, Q: 3 }")),
    ).toEqual([['Body "rocker" has no point "Q"', "bodies.rocker.shape.holes.Q", 35]]);
    const first = (holes: string) =>
      messages(shaped.replace("holes: { B: pin, O: pin }", `holes: ${holes}`))[0]?.[0];
    expect(first("{ B: bolt, O: 6 }")).toBe('Unknown parameter "bolt" in "bolt"');
    expect(first("{ B: pin, O: 0 }")).toBe("A hole's diameter must be more than zero");
    expect(first("{ B: 30 deg }")).toBe("Expected a length, got an angle");
  });

  it("has its holes inside the outline", () => {
    expect(
      messages(shaped.replace("holes: { B: pin, O: pin }", "holes: { B: 30 }"))[0]?.[0],
    ).toMatch(/^Two outlines cross at /);
  });
});
