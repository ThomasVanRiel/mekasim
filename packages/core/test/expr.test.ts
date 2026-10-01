import { describe, expect, it } from "vitest";
import { type EvalContext, evaluate, type Quantity, toSI } from "../src/expr/evaluate.ts";
import { ExprError, parseExpr } from "../src/expr/parse.ts";
import {
  ANGLE,
  ANGULAR_SPEED,
  formatQuantity,
  LENGTH,
  NONE,
  type Units,
} from "../src/expr/units.ts";

const units: Units = { length: "mm", angle: "deg" };

function context(names: Record<string, Quantity> = {}): EvalContext {
  return {
    units,
    resolve(name, node) {
      const value = names[name];
      if (!value) throw new ExprError(`Unknown name "${name}"`, node.pos);
      return value;
    },
  };
}

function run(src: string, names?: Record<string, Quantity>): Quantity {
  return evaluate(parseExpr(src), context(names));
}

const r: Quantity = { value: 0.04, dim: LENGTH };

describe("parsing", () => {
  it("respects precedence and associativity", () => {
    expect(run("1 + 2 * 3").value).toBe(7);
    expect(run("(1 + 2) * 3").value).toBe(9);
    expect(run("10 - 4 - 3").value).toBe(3);
    expect(run("2 ^ 3 ^ 2").value).toBe(512);
    expect(run("-2 ^ 2").value).toBe(-4);
    expect(run("2 * -3").value).toBe(-6);
  });

  it("reads number formats", () => {
    expect(run("1.5e2").value).toBe(150);
    expect(run(".5").value).toBe(0.5);
  });

  it("reports where an expression is wrong", () => {
    expect(() => parseExpr("2 * (3 + 4")).toThrow('Expected ")"');
    expect(() => parseExpr("2 +")).toThrow("Unexpected end of expression");
    expect(() => parseExpr("2 $ 3")).toThrow('Unexpected "$"');
    expect(() => parseExpr("40 furlongs")).toThrow('Unknown unit "furlongs"');
  });
});

describe("units", () => {
  it("converts literals to SI", () => {
    expect(run("40 mm")).toEqual({ value: 0.04, dim: LENGTH });
    expect(run("40mm").value).toBe(0.04);
    expect(run("2 in").value).toBeCloseTo(0.0508, 12);
    expect(run("180 deg").value).toBeCloseTo(Math.PI, 12);
    expect(run("300 rpm").value).toBeCloseTo(10 * Math.PI, 12);
    expect(run("300 rpm").dim).toEqual(ANGULAR_SPEED);
    expect(run("5 rad/s").value).toBe(5);
  });

  it("reads a plain number next to a quantity in document units", () => {
    expect(run("r + 10", { r }).value).toBeCloseTo(0.05, 12);
    expect(run("10 + r", { r }).value).toBeCloseTo(0.05, 12);
    expect(run("30 deg + 60").value).toBeCloseTo(Math.PI / 2, 12);
  });

  it("tracks dimensions through arithmetic", () => {
    expect(run("2 * r", { r })).toEqual({ value: 0.08, dim: LENGTH });
    expect(run("r / r", { r }).dim).toEqual(NONE);
    expect(run("sqrt(r ^ 2 + (30 mm) ^ 2)", { r }).value).toBeCloseTo(0.05, 12);
    expect(run("sqrt(r ^ 2)", { r }).dim).toEqual(LENGTH);
    expect(run("hypot(r, 30 mm)", { r }).value).toBeCloseTo(0.05, 12);
  });

  it("treats a rotation speed times a radius as a speed", () => {
    const speed = run("10 rad/s * r", { r });
    expect(formatQuantity(speed.value as number, speed.dim, units)).toBe("400 mm/s");
  });

  it("expresses an acceleration as a multiple of gravity", () => {
    expect(run("r * (10 rad/s) ^ 2 / g", { r })).toEqual({ value: 4 / 9.80665, dim: NONE });
  });

  it("refuses to mix dimensions", () => {
    expect(() => run("r + 30 deg", { r })).toThrow("Cannot combine a length with an angle");
    expect(() => run("sin(r)", { r })).toThrow("sin() needs an angle, got a length");
  });

  it("takes angles in document units for trigonometry", () => {
    expect(run("sin(30)").value).toBeCloseTo(0.5, 12);
    expect(run("sin(30 deg)").value).toBeCloseTo(0.5, 12);
    expect(run("cos(pi * 1 rad)").value).toBeCloseTo(-1, 12);
    expect(run("atan2(1, 1)")).toEqual({ value: Math.PI / 4, dim: ANGLE });
    expect(run("r * cos(60)", { r }).value).toBeCloseTo(0.02, 12);
  });

  it("formats in document units", () => {
    expect(formatQuantity(0.04, LENGTH, units)).toBe("40 mm");
    expect(formatQuantity(Math.PI, ANGLE, units)).toBe("180 deg");
    expect(formatQuantity(1.5, [1, -2, 0, 0], units)).toBe("1500 mm/s²");
    expect(formatQuantity(0.25, NONE, units)).toBe("0.25");
  });
});

describe("toSI", () => {
  it("reads plain numbers in the field's unit", () => {
    expect(toSI(run("40"), LENGTH, units)).toBeCloseTo(0.04, 12);
    expect(toSI(run("300"), ANGULAR_SPEED, units, "rpm")).toBeCloseTo(10 * Math.PI, 12);
    expect(toSI(run("5 rad/s"), ANGULAR_SPEED, units, "rpm")).toBe(5);
  });

  it("rejects the wrong kind of quantity", () => {
    expect(() => toSI(run("30 deg"), LENGTH, units)).toThrow("Expected a length, got an angle");
  });
});

describe("signals", () => {
  const signal: Quantity = { value: Float64Array.of(0.01, 0.03, -0.02), dim: LENGTH };

  it("applies arithmetic to every sample", () => {
    const result = run("2 * s + 10", { s: signal }).value as Float64Array;
    [0.03, 0.07, -0.03].forEach((expected, k) => {
      expect(result[k]).toBeCloseTo(expected, 12);
    });
  });

  it("collapses a signal with min, max, range and mean", () => {
    expect(run("min(s)", { s: signal }).value).toBe(-0.02);
    expect(run("max(s)", { s: signal }).value).toBe(0.03);
    expect(run("range(s)", { s: signal }).value).toBeCloseTo(0.05, 12);
    expect(run("mean(s)", { s: signal }).value).toBeCloseTo(0.02 / 3, 12);
    expect(run("max(abs(s))", { s: signal }).dim).toEqual(LENGTH);
  });

  it("compares sample by sample when min or max get several arguments", () => {
    expect(Array.from(run("max(s, 0)", { s: signal }).value as Float64Array)).toEqual([
      0.01, 0.03, 0,
    ]);
  });
});

describe("functions", () => {
  it("rejects unknown functions and wrong argument counts", () => {
    expect(() => run("frob(1)")).toThrow('Unknown function "frob"');
    expect(() => run("sqrt(1, 2)")).toThrow("sqrt() takes 1 argument, got 2");
    expect(() => run("atan2(1)")).toThrow("atan2() takes 2 arguments, got 1");
  });
});
