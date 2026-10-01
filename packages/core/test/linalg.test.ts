import { describe, expect, it } from "vitest";
import {
  luSolve,
  type Mat,
  mat,
  matFrom,
  pinvSolve,
  rankOf,
  solveLinear,
  svd,
} from "../src/solver/linalg.ts";

/** Deterministic pseudo-random numbers in [-1, 1]. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return (state / 2 ** 32) * 2 - 1;
  };
}

function randomMat(rows: number, cols: number, seed: number): Mat {
  const next = random(seed);
  const m = mat(rows, cols);
  for (let i = 0; i < m.data.length; i++) m.data[i] = next();
  return m;
}

function multiply(a: Mat, x: Float64Array): Float64Array {
  const out = new Float64Array(a.rows);
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) out[i] += a.data[i * a.cols + j] * x[j];
  }
  return out;
}

function expectClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-10,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(tolerance);
}

describe("luSolve", () => {
  it("solves a system that needs pivoting", () => {
    const a = matFrom([
      [0, 2, 1],
      [1, 1, 0],
      [2, 0, 3],
    ]);
    const x = luSolve(a, Float64Array.of(7, 3, 11));
    expectClose(x as Float64Array, [1, 2, 3]);
  });

  it("solves random systems", () => {
    const a = randomMat(12, 12, 1);
    const x = Float64Array.from({ length: 12 }, (_, i) => i - 5);
    expectClose(luSolve(a, multiply(a, x)) as Float64Array, x, 1e-9);
  });

  it("refuses a singular matrix", () => {
    const a = matFrom([
      [1, 2],
      [2, 4],
    ]);
    expect(luSolve(a, Float64Array.of(1, 2))).toBeNull();
  });
});

describe("svd", () => {
  it.each([
    ["tall", 7, 4],
    ["square", 5, 5],
    ["wide", 3, 6],
  ])("reconstructs a %s matrix", (_name, rows, cols) => {
    const a = randomMat(rows, cols, rows * 31 + cols);
    const { u, s, v } = svd(a);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < cols; k++) sum += u.data[i * cols + k] * s[k] * v.data[j * cols + k];
        expect(Math.abs(sum - a.data[i * cols + j])).toBeLessThan(1e-12);
      }
    }
  });

  it("finds the rank", () => {
    expect(rankOf(svd(randomMat(6, 4, 3)))).toBe(4);
    expect(rankOf(svd(randomMat(3, 6, 4)))).toBe(3);
    const dependent = matFrom([
      [1, 2, 3],
      [2, 4, 6],
      [1, 0, 1],
    ]);
    expect(rankOf(svd(dependent))).toBe(2);
  });
});

describe("pinvSolve", () => {
  it("gives the shortest solution of an underdetermined system", () => {
    // x + y = 2 has many solutions; (1, 1) is the one nearest the origin.
    const x = pinvSolve(svd(matFrom([[1, 1]])), Float64Array.of(2));
    expectClose(x, [1, 1]);
  });

  it("gives the least-squares solution of an overdetermined system", () => {
    const a = matFrom([[1], [1], [1]]);
    expectClose(pinvSolve(svd(a), Float64Array.of(1, 2, 6)), [3]);
  });

  it("solves a consistent system with a repeated equation", () => {
    const a = matFrom([
      [1, 0],
      [0, 1],
      [1, 0],
    ]);
    expectClose(pinvSolve(svd(a), Float64Array.of(4, 5, 4)), [4, 5]);
  });
});

describe("solveLinear", () => {
  it("falls back to the pseudo-inverse for a singular square matrix", () => {
    const a = matFrom([
      [1, 1],
      [1, 1],
    ]);
    expectClose(solveLinear(a, Float64Array.of(2, 2)), [1, 1]);
  });
});
