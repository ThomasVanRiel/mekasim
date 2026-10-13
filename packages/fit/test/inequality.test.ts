import { matFrom } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";
import {
  contactInequalities,
  contactInequality,
  linearizeInequalities,
} from "../src/solver/inequality.ts";
import { solveQp } from "../src/solver/qp.ts";

describe("one-sided contact rows", () => {
  it("has the hand-calculated translation and rotation derivatives", () => {
    const row = contactInequality(
      "faces",
      { id: "a", body: 0, origin: { x: 1, y: 2, angle: 0 } },
      { id: "b", body: 1, origin: { x: 5, y: 6, angle: 0 } },
      { distance: 0.1, a: [2, 4], b: [3, 4], normal: [1, 0] },
      6,
    );
    // A moving right closes the gap; turning A moves its point left by 2 dphi.
    // B moving right opens it; turning B moves its point right by 2 dphi.
    expect(Array.from(row.gradient)).toEqual([-1, 0, 2, 1, 0, 2]);
    expect(row).toMatchObject({
      source: "faces",
      kind: "contact",
      value: 0.1,
      between: ["a", "b"],
    });
  });

  it("leaves ground out of the coordinates", () => {
    const row = contactInequality(
      "wall",
      { id: "ground", body: -1, origin: { x: 0, y: 0, angle: 0 } },
      { id: "block", body: 0, origin: { x: 2, y: 0, angle: 0 } },
      { distance: 0.2, a: [1, 0], b: [1.2, 0], normal: [1, 0] },
      3,
    );
    expect(Array.from(row.gradient)).toEqual([1, 0, 0]);
  });

  it("becomes G dq >= -g and corrects a closing trial step", () => {
    const row = contactInequality(
      "wall",
      { id: "ground", body: -1, origin: { x: 0, y: 0, angle: 0 } },
      { id: "block", body: 0, origin: { x: 2, y: 0, angle: 0 } },
      { distance: 0.2, a: [1, 0], b: [1.2, 0], normal: [1, 0] },
      3,
    );
    const { normals, limits } = linearizeInequalities([row], 3);
    expect(Array.from(normals.data)).toEqual([1, 0, 0]);
    expect(Array.from(limits)).toEqual([-0.2]);

    // The free minimum asks for dx = -1, but the wall permits only dx >= -0.2.
    const solved = solveQp(
      matFrom([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
      Float64Array.of(1, 0, 0),
      normals,
      limits,
    );
    expect(solved?.x[0]).toBeCloseTo(-0.2, 12);
  });

  it("makes rows for every nearby place of a compiled contact pair", () => {
    const model = `mekafit: 1
bodies:
  ground:
    points: { O: [0, 0], B: [11, 0] }
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
joints:
  fixed: { type: weld, connect: [ground.B, block.O] }
contacts:
  faces: { between: [ground, block] }
`;
    const result = simulate(model);
    expect(result.diagnostics).toEqual([]);
    const rows = contactInequalities(
      result.compiled as NonNullable<typeof result.compiled>,
      result.cycle?.q as Float64Array,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ source: "faces", between: ["ground", "block"] });
      expect(row.value).toBeCloseTo(0.001, 12);
    }
  });
});
