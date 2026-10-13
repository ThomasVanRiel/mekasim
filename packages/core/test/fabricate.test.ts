import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toDxf, toPointsDxf } from "../src/fabricate/dxf.ts";
import {
  buildParts,
  checkFabrication,
  type Fabrication,
  layoutParts,
  type Part,
} from "../src/fabricate/parts.ts";
import type { Point } from "../src/geometry/outline.ts";
import { simulate } from "../src/simulate.ts";

function example(name: string): string {
  return readFileSync(new URL(`../../../examples/${name}.mekasim.yaml`, import.meta.url), "utf8");
}

/** Links 20 mm wide and 5 mm thick, on 6 mm pins with 0.2 mm of play. */
const SIZES: Fabrication = { width: 0.02, thickness: 0.005, hole: 0.006, clearance: 0.0002 };

function area(polygon: Point[]): number {
  return polygon.reduce((sum, [x, y], i) => {
    const [nx, ny] = polygon[(i + 1) % polygon.length] as Point;
    return sum + (x * ny - nx * y) / 2;
  }, 0);
}

function part(parts: Part[], id: string): Part {
  const found = parts.find((p) => p.id === id);
  if (!found) throw new Error(`no part ${id}`);
  return found;
}

describe("buildParts", () => {
  const parts = buildParts(simulate(example("four-bar")), SIZES);

  it("makes a plate for each moving body and a base plate for the ground", () => {
    expect(parts.map((p) => p.id)).toEqual(["ground", "crank", "coupler", "rocker"]);
  });

  it("makes no part of a hidden body", () => {
    const hidden = example("four-bar").replace("  coupler:\n", "  coupler:\n    hidden: true\n");
    expect(buildParts(simulate(hidden), SIZES).map((p) => p.id)).toEqual([
      "ground",
      "crank",
      "rocker",
    ]);
  });

  it("drills one hole where two points of a body lie on the same place", () => {
    // Each frame pivot of the strandbeest carries two joints, on two points of the ground.
    const ground = part(buildParts(simulate(example("strandbeest")), SIZES), "ground");
    expect(ground.holes).toHaveLength(3);
  });

  it("makes a link as long as its points are apart and as wide as asked", () => {
    // The crank is 40 mm between pins: a 40 x 20 mm rectangle with a 20 mm round at each end.
    const crank = part(parts, "crank");
    expect(area(crank.outline)).toBeCloseTo(0.04 * 0.02 + Math.PI * 0.01 ** 2, 6);
  });

  it("drills a hole with clearance at every pinned point, and none elsewhere", () => {
    expect(part(parts, "crank").holes).toEqual([
      { x: 0, y: 0, diameter: 0.0062 },
      { x: 0.04, y: 0, diameter: 0.0062 },
    ]);
    // The coupler has three points; its point P carries no pin.
    expect(part(parts, "coupler").holes.map((h) => [h.x, h.y])).toEqual([
      [0, 0],
      [0.16, 0],
    ]);
  });

  it("gives the base plate the fixed pivots, with more material round them", () => {
    const ground = part(parts, "ground");
    expect(ground.holes.map((h) => [h.x, h.y])).toEqual([
      [0, 0],
      [0.18, 0],
    ]);
    expect(area(ground.outline)).toBeCloseTo(0.18 * 0.04 + Math.PI * 0.02 ** 2, 5);
  });

  it("cuts a slot as long as the travel of a pin that slides", () => {
    const crank = buildParts(simulate(example("slider-crank")), SIZES);
    const [slot] = part(crank, "ground").slots;
    // The rod end runs between 405 and 435 mm along the ground axis.
    expect(slot?.from[0]).toBeCloseTo(0.405, 9);
    expect(slot?.to[0]).toBeCloseTo(0.435, 9);
    expect(slot?.width).toBeCloseTo(0.0062, 12);
    expect(part(crank, "rod").holes).toHaveLength(2);
  });

  it("makes a cam as a plate of its own, bored at its centre", () => {
    const cam = part(buildParts(simulate(example("cam-follower")), SIZES), "contact");
    const radii = cam.outline.map(([x, y]) => Math.hypot(x, y));
    expect(Math.min(...radii)).toBeCloseTo(0.022, 6);
    expect(cam.holes).toEqual([{ x: 0, y: 0, diameter: 0.0062 }]);
  });

  it("makes parts of a model built from components", () => {
    const built = buildParts(simulate(example("shaker-components")), SIZES);
    expect(built.map((p) => p.id)).toEqual([
      "ground",
      "eccentric",
      "rocker",
      "upper_arm",
      "lower_arm",
      "pitman",
      "upper_deck",
      "lower_deck",
    ]);
    // The rocker carries its pivot, the pitman and both decks.
    expect(part(built, "rocker").holes).toHaveLength(4);
  });
});

describe("checkFabrication", () => {
  it("accepts sizes that can be made", () => {
    expect(checkFabrication(SIZES)).toEqual([]);
  });

  it("says why sizes cannot be made", () => {
    expect(checkFabrication({ ...SIZES, hole: 0.03 })).toEqual([
      "The holes are as wide as the links. Make the links wider or the holes smaller.",
    ]);
    expect(checkFabrication({ ...SIZES, thickness: 0 })).toEqual([
      "The thickness must be more than zero.",
    ]);
  });
});

describe("layoutParts", () => {
  const parts = buildParts(simulate(example("four-bar")), SIZES);
  const placed = layoutParts(parts, 0.005);

  it("lays every part lengthwise from the left edge", () => {
    for (const p of placed) {
      const xs = p.outline.map(([x]) => x);
      const ys = p.outline.map(([, y]) => y);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(
        Math.max(...ys) - Math.min(...ys) - 1e-9,
      );
    }
  });

  it("stacks the parts without overlap, the gap between them", () => {
    let top = 0;
    for (const p of placed) {
      const ys = p.outline.map(([, y]) => y);
      expect(Math.min(...ys)).toBeCloseTo(top, 9);
      top = Math.max(...ys) + 0.005;
    }
  });

  it("keeps each part's shape and its holes where they belong", () => {
    placed.forEach((p, i) => {
      expect(area(p.outline)).toBeCloseTo(area((parts[i] as Part).outline), 9);
    });
    const crank = part(placed, "crank");
    const [a, b] = crank.holes;
    if (!a || !b) throw new Error("the crank should have two holes");
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(0.04, 9);
  });
});

describe("toDxf", () => {
  const parts = layoutParts(buildParts(simulate(example("four-bar")), SIZES), 0.005);
  const dxf = toDxf(parts, { length: "mm", angle: "deg" }, (id) => id.toUpperCase());
  const lines = dxf.split("\n");
  /** Values that follow a group code, across the file. */
  const count = (code: string, value: string): number =>
    lines.filter((line, i) => line === value && lines[i - 1] === code).length;

  it("is a complete drawing in millimetres", () => {
    expect(dxf.startsWith("0\nSECTION\n2\nHEADER\n")).toBe(true);
    expect(dxf.endsWith("0\nENDSEC\n0\nEOF\n")).toBe(true);
    expect(dxf).toContain("9\n$INSUNITS\n70\n4\n");
  });

  it("has an outline and a name for every part, and a circle for every hole", () => {
    expect(count("0", "POLYLINE")).toBe(4);
    expect(count("0", "TEXT")).toBe(4);
    expect(count("0", "CIRCLE")).toBe(8);
    expect(count("1", "CRANK")).toBe(1);
  });

  it("writes sizes in the model's unit", () => {
    // A hole of 6.2 mm has a radius of 3.1.
    expect(dxf).toContain("\n40\n3.1\n");
    expect(dxf).not.toContain("0.0031");
  });

  it("puts slots on the holes layer as closed outlines", () => {
    const slider = layoutParts(buildParts(simulate(example("slider-crank")), SIZES), 0.005);
    const text = toDxf(slider, { length: "mm", angle: "deg" });
    expect(text.split("0\nPOLYLINE\n8\nholes\n").length - 1).toBe(1);
  });
});

describe("fabrication in the model", () => {
  it("is read in the model's units", () => {
    const text = `${example("slider-crank")}\nfabrication: { width: 20, thickness: 5 mm, hole: 0.6 cm }\n`;
    const simulation = simulate(text);
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.compiled?.fabrication).toEqual({
      width: 0.02,
      thickness: 0.005,
      hole: expect.closeTo(0.006, 12),
    });
  });

  it("rejects a size of zero", () => {
    const simulation = simulate(`${example("slider-crank")}\nfabrication: { width: 0 }\n`);
    expect(simulation.diagnostics.map((d) => d.message)).toEqual(["This must be more than zero"]);
  });
});

describe("toPointsDxf", () => {
  const dxf = toPointsDxf(simulate(example("four-bar")), (id) => id.toUpperCase());
  const lines = dxf.split("\n");
  /** The entities of a kind, each as its group codes and values. */
  const entities = (kind: string): Map<string, string>[] => {
    const found: Map<string, string>[] = [];
    for (let i = lines.indexOf("ENTITIES") + 1; i < lines.length - 1; i += 2) {
      if (lines[i] === "0") found.push(new Map([["0", lines[i + 1] as string]]));
      else found.at(-1)?.set(lines[i] as string, lines[i + 1] as string);
    }
    return found.filter((entity) => entity.get("0") === kind);
  };
  const points = entities("POINT");

  it("is a complete drawing in the model's unit", () => {
    expect(dxf.startsWith("0\nSECTION\n2\nHEADER\n")).toBe(true);
    expect(dxf.endsWith("0\nENDSEC\n0\nEOF\n")).toBe(true);
    expect(dxf).toContain("9\n$INSUNITS\n70\n4\n");
  });

  it("has one point for every joint, and the fixed pivots where the model puts them", () => {
    const joints = points.filter((p) => p.get("8") === "joints");
    expect(joints).toHaveLength(4);
    expect(joints.map((p) => `${p.get("10")},${p.get("20")}`)).toEqual(
      expect.arrayContaining(["0,0", "180,0"]),
    );
  });

  it("places the joints as the links stand at the start of the cycle", () => {
    const simulation = simulate(example("four-bar"));
    const { compiled, cycle } = simulation;
    if (!compiled || !cycle) throw new Error("the four-bar should solve");
    const crank = compiled.bodies.get("crank");
    const tip = [...(crank?.points.values() ?? [])].find((p) => p.u !== 0 || p.v !== 0);
    if (!crank || !tip) throw new Error("the crank should have a tip");
    const at = 3 * crank.index;
    const phi = cycle.q[at + 2];
    const x = cycle.q[at] + tip.u * Math.cos(phi) - tip.v * Math.sin(phi);
    const y = cycle.q[at + 1] + tip.u * Math.sin(phi) + tip.v * Math.cos(phi);
    const near = points.filter(
      (p) =>
        Math.abs(Number(p.get("10")) - x * 1000) < 1e-3 &&
        Math.abs(Number(p.get("20")) - y * 1000) < 1e-3,
    );
    expect(near).toHaveLength(1);
  });

  it("keeps a point that carries no joint apart from the joints", () => {
    // The coupler's point P is the only one without a pin.
    expect(points.filter((p) => p.get("8") === "points")).toHaveLength(1);
    expect(entities("TEXT").map((t) => t.get("1"))).toContain("COUPLER P");
  });

  it("draws every link through its points, and the ground apart", () => {
    // Crank and rocker are lines, the coupler with its third point a triangle.
    expect(
      entities("LINE")
        .map((l) => l.get("8"))
        .sort(),
    ).toEqual(["ground", "links", "links"]);
    expect(entities("POLYLINE").map((l) => l.get("8"))).toEqual(["links"]);
    expect(entities("VERTEX")).toHaveLength(3);
  });

  it("is empty for a model that cannot be drawn", () => {
    expect(toPointsDxf(simulate("not a model"))).toBe("");
  });
});
