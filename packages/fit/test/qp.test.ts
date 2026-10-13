import { mat, matFrom } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { solveQp } from "../src/solver/qp.ts";

function expectClose(actual: ArrayLike<number>, expected: number[]): void {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, i) => {
    expect(actual[i]).toBeCloseTo(value, 12);
  });
}

describe("the dense quadratic program", () => {
  it("takes the unconstrained minimum", () => {
    const result = solveQp(
      matFrom([
        [2, 0],
        [0, 4],
      ]),
      Float64Array.of(-4, 8),
      mat(0, 2),
      new Float64Array(),
    );
    expectClose(result?.x as Float64Array, [2, -2]);
    expect(result?.active).toEqual([]);
  });

  it("stops at one bound with its hand-calculated multiplier", () => {
    // min (x - 2)^2, x >= 3: x = 3 and 2x - 4 - lambda = 0 gives lambda = 2.
    const result = solveQp(matFrom([[2]]), Float64Array.of(-4), matFrom([[1]]), Float64Array.of(3));
    expectClose(result?.x as Float64Array, [3]);
    expectClose(result?.multipliers as Float64Array, [2]);
    expect(result?.active).toEqual([0]);
  });

  it("finds a corner made by several bounds", () => {
    // The nearest point to the origin with x >= 1 and y >= 2 is plainly (1, 2).
    const result = solveQp(
      matFrom([
        [1, 0],
        [0, 1],
      ]),
      Float64Array.of(0, 0),
      matFrom([
        [1, 0],
        [0, 1],
      ]),
      Float64Array.of(1, 2),
    );
    expectClose(result?.x as Float64Array, [1, 2]);
    expectClose(result?.multipliers as Float64Array, [1, 2]);
  });

  it("handles an oblique and a redundant bound", () => {
    // The nearest point to the origin beyond x + y = 2 is (1, 1).
    const result = solveQp(
      matFrom([
        [1, 0],
        [0, 1],
      ]),
      Float64Array.of(0, 0),
      matFrom([
        [1, 1],
        [2, 2],
      ]),
      Float64Array.of(2, 4),
    );
    expectClose(result?.x as Float64Array, [1, 1]);
    expect(result?.multipliers.every((value) => value >= 0)).toBe(true);
  });

  it("reports incompatible bounds", () => {
    const result = solveQp(
      matFrom([[1]]),
      Float64Array.of(0),
      matFrom([[1], [-1]]),
      Float64Array.of(1, 0),
    );
    expect(result).toBeUndefined();
  });

  it("rejects a Hessian that is not positive definite", () => {
    expect(() =>
      solveQp(
        matFrom([
          [1, 0],
          [0, 0],
        ]),
        Float64Array.of(0, 0),
        mat(0, 2),
        new Float64Array(),
      ),
    ).toThrow("positive definite");
  });
});
