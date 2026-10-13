import { describe, expect, it } from "vitest";
import { advance, comfortableRate, stepped } from "./playback.ts";

const turning = { count: 360, dt: 0.001, periodic: true };

describe("playback", () => {
  it("moves on by the time that passed, at the rate chosen", () => {
    expect(advance(10, 0.02, 1, turning)).toBeCloseTo(30, 9);
    expect(advance(10, 0.02, 0.5, turning)).toBeCloseTo(20, 9);
  });

  it("goes round a run that repeats", () => {
    expect(advance(350, 0.02, 1, turning)).toBeCloseTo(10, 9);
  });

  it("starts a run that ends again from its beginning", () => {
    const once = { ...turning, periodic: false };
    expect(advance(350, 0.005, 1, once)).toBeCloseTo(355, 9);
    expect(advance(350, 0.02, 1, once)).toBe(0);
  });

  it("does not leap over a long gap", () => {
    expect(advance(0, 30, 1, turning)).toBeCloseTo(100, 9);
  });

  it("stands still when there is nothing to play", () => {
    expect(advance(3, 0.02, 1, { count: 1, dt: 0, periodic: false })).toBe(0);
  });

  it("steps one sample at a time, round the ends", () => {
    expect(stepped(4.6, 1, 360)).toBe(5);
    expect(stepped(0.2, -1, 360)).toBe(359);
    expect(stepped(359, 1, 360)).toBe(0);
  });

  it("slows a fast cycle down to where it can be followed", () => {
    expect(comfortableRate(2)).toBe(1);
    expect(comfortableRate(0.2)).toBe(0.1);
    expect(comfortableRate(0.0001)).toBe(0.01);
  });
});
