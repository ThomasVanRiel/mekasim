import { simulate as simulateModel } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";

const model = `mekafit: 1
bodies:
  ground:
    points: { O: [0, 0] }
measures:
  force: 2 N
  torque_m: 2 N*m
  torque_mm: 2000 N*mm
  linear_stiffness: 2 N/mm
  torsion_rad: 2 N*m/rad
  torsion_deg: 2 N*mm/deg
`;

const quantity = (id: string) =>
  simulate(model).measures.find((measure) => measure.id === id)?.quantity;

describe("mekafit's force units", () => {
  it("reads force, torque and stiffness as SI values", () => {
    expect(simulate(model).diagnostics).toEqual([]);
    expect(quantity("force")).toEqual({ value: 2, dim: [1, -2, 1, 0] });
    expect(quantity("torque_m")).toEqual({ value: 2, dim: [2, -2, 1, 0] });
    expect(quantity("torque_mm")).toEqual({ value: 2, dim: [2, -2, 1, 0] });
    expect(quantity("linear_stiffness")).toEqual({ value: 2000, dim: [0, -2, 1, 0] });
    expect(quantity("torsion_rad")).toEqual({ value: 2, dim: [2, -2, 1, 0] });
    expect(quantity("torsion_deg")?.value).toBeCloseTo((2 * 0.001) / (Math.PI / 180), 14);
    expect(quantity("torsion_deg")?.dim).toEqual([2, -2, 1, 0]);
  });

  it("does not add the units to mekasim", () => {
    const result = simulateModel(model.replace("mekafit: 1", "mekasim: 1"));
    expect(result.diagnostics.map(({ message }) => message)).toContain('Unknown unit "N" in "2 N"');
  });
});
