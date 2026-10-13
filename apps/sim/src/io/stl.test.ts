import { readFileSync } from "node:fs";
import { buildParts, type Fabrication, layoutParts, simulate } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { toStl } from "./stl.ts";

const SIZES: Fabrication = { width: 0.02, thickness: 0.005, hole: 0.006, clearance: 0 };

function parts(name: string) {
  const text = readFileSync(
    new URL(`../../../../examples/${name}.mekasim.yaml`, import.meta.url),
    "utf8",
  );
  return layoutParts(buildParts(simulate(text), SIZES), 0.005);
}

/** Triangles of a binary STL, each as three corners. */
function triangles(stl: ArrayBuffer): number[][][] {
  const view = new DataView(stl);
  const count = view.getUint32(80, true);
  expect(stl.byteLength).toBe(84 + 50 * count);
  return Array.from({ length: count }, (_, i) => {
    const at = 84 + 50 * i + 12;
    return [0, 1, 2].map((corner) =>
      [0, 1, 2].map((axis) => view.getFloat32(at + 12 * corner + 4 * axis, true)),
    );
  });
}

/** Volume enclosed by the triangles. */
function volume(mesh: number[][][]): number {
  let total = 0;
  for (const [a, b, c] of mesh as [number[], number[], number[]][]) {
    total +=
      ((a[0] as number) *
        ((b[1] as number) * (c[2] as number) - (b[2] as number) * (c[1] as number)) -
        (a[1] as number) *
          ((b[0] as number) * (c[2] as number) - (b[2] as number) * (c[0] as number)) +
        (a[2] as number) *
          ((b[0] as number) * (c[1] as number) - (b[1] as number) * (c[0] as number))) /
      6;
  }
  return Math.abs(total);
}

describe("toStl", () => {
  it("makes a solid of the right size, in millimetres, holes cut through", () => {
    const crank = parts("four-bar").filter((p) => p.id === "crank");
    const mesh = triangles(toStl(crank, SIZES.thickness));
    // A 40 x 20 mm link with round ends, less two 6 mm holes, 5 mm thick.
    const face = 40 * 20 + Math.PI * 10 ** 2 - 2 * Math.PI * 3 ** 2;
    expect(volume(mesh) / (face * 5)).toBeCloseTo(1, 2);
  });

  it("lies flat on the bed from zero to the thickness", () => {
    const mesh = triangles(toStl(parts("four-bar"), SIZES.thickness));
    const heights = mesh.flat().map((corner) => corner[2] as number);
    expect(Math.min(...heights)).toBeCloseTo(0, 6);
    expect(Math.max(...heights)).toBeCloseTo(5, 6);
  });

  it("cuts each hole once where several joints share its place", () => {
    const ground = parts("strandbeest").filter((p) => p.id === "ground");
    expect(ground[0]?.holes).toHaveLength(3);
    const solid = volume(
      triangles(
        toStl(
          ground.map((p) => ({ ...p, holes: [] })),
          SIZES.thickness,
        ),
      ),
    );
    const drilled = volume(triangles(toStl(ground, SIZES.thickness)));
    expect((solid - drilled) / (3 * Math.PI * 3 ** 2 * 5)).toBeCloseTo(1, 2);
  });

  it("cuts slots through", () => {
    const ground = parts("slider-crank").filter((p) => p.id === "ground");
    const withSlot = volume(triangles(toStl(ground, SIZES.thickness)));
    const solid = volume(
      triangles(
        toStl(
          ground.map((p) => ({ ...p, slots: [] })),
          SIZES.thickness,
        ),
      ),
    );
    // The slot is 30 mm of travel by 6 mm wide, with round ends.
    expect(solid - withSlot).toBeCloseTo((30 * 6 + Math.PI * 3 ** 2) * 5, -1);
  });
});
