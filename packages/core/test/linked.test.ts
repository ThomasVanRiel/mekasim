import { describe, expect, it } from "vitest";
import { linkedAt } from "../src/edit/linked.ts";

const MODEL = `mekasim: 1
params:
  r: 40 mm          # crank radius
  rpm: 300
  m: 2 * r
bodies:
  ground:
    points: { O2: [0, 0], O4: [180, 0] }
  crank:
    points: { O: [0, 0], A: [r, 0] }
  coupler:
    points: { A: [0, 0], B: [4 * r, 0], P: [80, 60] }
  rocker:
    points: { B: [0, 0], O: [110, 0] }
components:
  arm:
    type: crank
    at: rocker.O
    arms: { tip: [r, 90] }
joints:
  main:  { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }
  pin_b: { type: revolute, connect: [coupler.B, rocker.B] }
  rock:  { type: revolute, connect: [rocker.O, ground.O4] }
  mesh:  { type: gear, connect: [crank.O, rocker.O], sizes: [20, 40], carrier: coupler }
drivers:
  motor: { joint: main, speed: rpm }
traces: [coupler.P, arm.tip]
measures:
  reach: x(coupler.P) - r
  swing: range(angle(rocker))
  both: swing + dist(coupler, rocker) + 3 m
plots:
  path: [x(coupler.P), "y(coupler.P)", reach]
pose:
  coupler: [r, 0, 40]
  rocker: [160, 110, -80]
`;

/** The offset of the nth place a piece of text occurs, counting from 1. */
function nth(needle: string, n = 1): number {
  let at = -1;
  for (let i = 0; i < n; i++) at = MODEL.indexOf(needle, at + 1);
  if (at < 0) throw new Error(`"${needle}" does not occur ${n} times`);
  return at;
}

/** The line each reference is on, with the reference bracketed, to read the result by eye. */
function shown(offset: number): string[] {
  const linked = linkedAt(MODEL, offset);
  if (!linked) return ["nothing"];
  return linked.references.map(({ from, to }) => {
    const start = MODEL.lastIndexOf("\n", from - 1) + 1;
    const end = MODEL.indexOf("\n", to);
    return `${MODEL.slice(start, from)}[${MODEL.slice(from, to)}]${MODEL.slice(to, end)}`.trim();
  });
}

describe("linkedAt", () => {
  it("finds a link everywhere it is referred to", () => {
    const linked = linkedAt(MODEL, nth("  coupler:") + 4);
    expect(linked).toMatchObject({ kind: "body", name: "coupler" });
    expect(shown(nth("  coupler:") + 4)).toEqual([
      "pin_a: { type: revolute, connect: [crank.A, [coupler].A] }",
      "pin_b: { type: revolute, connect: [[coupler].B, rocker.B] }",
      "mesh:  { type: gear, connect: [crank.O, rocker.O], sizes: [20, 40], carrier: [coupler] }",
      "traces: [[coupler].P, arm.tip]",
      "reach: x([coupler].P) - r",
      "both: swing + dist([coupler], rocker) + 3 m",
      'path: [x([coupler].P), "y(coupler.P)", reach]',
      'path: [x(coupler.P), "y([coupler].P)", reach]',
      "[coupler]: [r, 0, 40]",
    ]);
  });

  it("finds a point where it is pinned, traced and measured, but not its namesakes", () => {
    // Point P of the coupler.
    expect(shown(nth("P: [80"))).toEqual([
      "traces: [coupler.[P], arm.tip]",
      "reach: x(coupler.[P]) - r",
      'path: [x(coupler.[P]), "y(coupler.P)", reach]',
      'path: [x(coupler.P), "y(coupler.[P])", reach]',
    ]);
    // Point A of the crank, not point A of the coupler.
    expect(shown(nth("A: [r, 0]"))).toEqual([
      "pin_a: { type: revolute, connect: [crank.[A], coupler.A] }",
    ]);
  });

  it("finds a parameter in every expression, and not where the letters mean something else", () => {
    expect(shown(nth("  r: 40") + 2)).toEqual([
      "m: 2 * [r]",
      "points: { O: [0, 0], A: [[r], 0] }",
      "points: { A: [0, 0], B: [4 * [r], 0], P: [80, 60] }",
      "arms: { tip: [[r], 90] }",
      "reach: x(coupler.P) - [r]",
      "coupler: [[r], 0, 40]",
    ]);
    // The parameter m, not the metre in "3 m" or in "40 mm".
    expect(shown(nth("  m: 2") + 2)).toEqual([]);
  });

  it("finds a pin where a motor drives it", () => {
    expect(shown(nth("  main:") + 2)).toEqual(["motor: { joint: [main], speed: rpm }"]);
  });

  it("finds a measure where later measures and plots use it", () => {
    expect(shown(nth("  swing:") + 2)).toEqual(["both: [swing] + dist(coupler, rocker) + 3 m"]);
    expect(shown(nth("  reach:") + 2)).toEqual(['path: [x(coupler.P), "y(coupler.P)", [reach]]']);
  });

  it("finds a crank or rod like any other link, and its arms like points", () => {
    expect(shown(nth("  arm:") + 2)).toEqual(["traces: [coupler.P, [arm].tip]"]);
    expect(shown(nth("tip: [r"))).toEqual(["traces: [coupler.P, arm.[tip]]"]);
  });

  it("gives the definition's own place", () => {
    const linked = linkedAt(MODEL, nth("  rocker:") + 5);
    const { from, to } = linked?.definition ?? { from: 0, to: 0 };
    expect(MODEL.slice(from, to)).toBe("rocker");
    // Either end of the name counts as being on it.
    expect(linkedAt(MODEL, from)?.name).toBe("rocker");
    expect(linkedAt(MODEL, to)?.name).toBe("rocker");
  });

  it("finds nothing away from a definition, or in text that cannot be read", () => {
    expect(linkedAt(MODEL, nth("connect: [crank.A") + 12)).toBeUndefined();
    expect(linkedAt(MODEL, nth("# crank radius") + 3)).toBeUndefined();
    expect(linkedAt("bodies: [oops", 3)).toBeUndefined();
  });
});
