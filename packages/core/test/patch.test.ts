import { describe, expect, it } from "vitest";
import { applyEdit, type Edit, EditError } from "../src/edit/patch.ts";

const ORDER = ["mekasim", "params", "bodies", "joints", "drivers", "traces", "pose"];

const MODEL = `# A model with comments and its own spacing.
mekasim: 1

params:
  r: 40 mm          # crank radius
  rpm: 300

bodies:
  ground:
    points: { O2: [0, 0], O4: [180, 0] }
  crank:
    points: { O: [0, 0], A: [r, 0] }   # the driven link
    layer: 1

joints:
  main:  { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }

traces: [crank.A]
`;

function apply(edit: Edit, text = MODEL): string {
  return applyEdit(text, edit, ORDER);
}

/** The lines that differ, as `[before, after]`, to show that nothing else moved. */
function changed(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return {
    removed: a.filter((line) => !b.includes(line)),
    added: b.filter((line) => !a.includes(line)),
  };
}

describe("replacing a value", () => {
  it("rewrites only the value, keeping the comment beside it", () => {
    const result = apply({ op: "set", path: ["params", "r"], value: "55 mm" });
    expect(changed(MODEL, result)).toEqual({
      removed: ["  r: 40 mm          # crank radius"],
      added: ["  r: 55 mm          # crank radius"],
    });
  });

  it("rewrites a number in place", () => {
    const result = apply({ op: "set", path: ["params", "rpm"], value: 120 });
    expect(changed(MODEL, result).added).toEqual(["  rpm: 120"]);
  });

  it("rewrites one coordinate inside an inline list", () => {
    const result = apply({
      op: "set",
      path: ["bodies", "ground", "points", "O4"],
      value: [200, 5],
    });
    expect(changed(MODEL, result).added).toEqual(["    points: { O2: [0, 0], O4: [200, 5] }"]);
  });

  it("quotes text that YAML would otherwise misread", () => {
    const result = apply({ op: "set", path: ["params", "r"], value: "max(1, 2)" });
    expect(changed(MODEL, result).added).toEqual(["  r: max(1, 2)          # crank radius"]);
    const inline = apply({
      op: "set",
      path: ["bodies", "ground", "points", "O4"],
      value: ["max(1, 2)", 0],
    });
    expect(changed(MODEL, inline).added).toEqual([
      '    points: { O2: [0, 0], O4: ["max(1, 2)", 0] }',
    ]);
  });
});

describe("adding an entry", () => {
  it("appends to an inline map", () => {
    const result = apply({ op: "set", path: ["bodies", "crank", "points", "B"], value: [10, 20] });
    expect(changed(MODEL, result).added).toEqual([
      "    points: { O: [0, 0], A: [r, 0], B: [10, 20] }   # the driven link",
    ]);
  });

  it("appends a line to a map written in lines, after its last entry", () => {
    const result = apply({ op: "set", path: ["params", "L"], value: "160 mm" });
    expect(result).toContain("  rpm: 300\n  L: 160 mm\n\nbodies:");
    expect(changed(MODEL, result).removed).toEqual([]);
  });

  it("writes a new body over several lines", () => {
    const result = apply({
      op: "set",
      path: ["bodies", "link1"],
      value: { points: { A: [0, 0], B: [100, 0] } },
      block: 1,
    });
    expect(result).toContain(
      "    layer: 1\n  link1:\n    points: { A: [0, 0], B: [100, 0] }\n\njoints:",
    );
  });

  it("matches the indentation of the map it adds to", () => {
    const result = apply({
      op: "set",
      path: ["joints", "rock"],
      value: { type: "revolute", connect: ["rocker.O", "ground.O4"] },
    });
    expect(changed(MODEL, result)).toEqual({
      removed: [],
      added: ["  rock: { type: revolute, connect: [rocker.O, ground.O4] }"],
    });
  });

  it("appends to an inline list", () => {
    const result = apply({ op: "set", path: ["traces", 1], value: "crank.O" });
    expect(changed(MODEL, result).added).toEqual(["traces: [crank.A, crank.O]"]);
  });

  it("creates a missing section in its usual place", () => {
    const result = apply({
      op: "set",
      path: ["drivers", "motor"],
      value: { joint: "main", speed: 60 },
    });
    expect(result).toContain(
      "coupler.A] }\n\ndrivers:\n  motor: { joint: main, speed: 60 }\n\ntraces: [crank.A]\n",
    );
  });

  it("creates a missing section at the end when nothing comes after it", () => {
    const result = apply({ op: "set", path: ["pose", "crank"], value: [0, 0, 30] });
    expect(result.endsWith("traces: [crank.A]\n\npose:\n  crank: [0, 0, 30]\n")).toBe(true);
  });

  it("fills an empty map", () => {
    const empty = "mekasim: 1\n\nbodies: {}\n";
    const body = applyEdit(
      empty,
      { op: "set", path: ["bodies", "link1"], value: { points: { A: [0, 0] } }, block: 1 },
      ORDER,
    );
    expect(body).toBe("mekasim: 1\n\nbodies:\n  link1:\n    points: { A: [0, 0] }\n");

    const points = "bodies:\n  ground:\n    points: {}\n";
    const point = applyEdit(points, {
      op: "set",
      path: ["bodies", "ground", "points", "G1"],
      value: [1, 2],
    });
    expect(point).toBe("bodies:\n  ground:\n    points: { G1: [1, 2] }\n");
  });

  it("fills a section that has a key but no content", () => {
    const result = applyEdit("mekasim: 1\njoints:   # none yet\n", {
      op: "set",
      path: ["joints", "pin1"],
      value: { type: "revolute", connect: ["a.A", "b.A"] },
    });
    expect(result).toBe(
      "mekasim: 1\njoints:   # none yet\n  pin1: { type: revolute, connect: [a.A, b.A] }\n",
    );
  });
});

describe("removing an entry", () => {
  it("removes a line, with the comment on it", () => {
    const result = apply({ op: "delete", path: ["params", "r"] });
    expect(changed(MODEL, result)).toEqual({
      removed: ["  r: 40 mm          # crank radius"],
      added: [],
    });
  });

  it("removes an entry that spans several lines", () => {
    const result = apply({ op: "delete", path: ["bodies", "crank"] });
    expect(result).toContain("O4: [180, 0] }\n\njoints:");
  });

  it("removes from an inline map, first and last entries alike", () => {
    const first = apply({ op: "delete", path: ["bodies", "ground", "points", "O2"] });
    expect(changed(MODEL, first).added).toEqual(["    points: { O4: [180, 0] }"]);
    const last = apply({ op: "delete", path: ["bodies", "ground", "points", "O4"] });
    expect(changed(MODEL, last).added).toEqual(["    points: { O2: [0, 0] }"]);
  });

  it("leaves an empty list or map behind when the last entry goes", () => {
    const list = apply({ op: "delete", path: ["traces", 0] });
    expect(changed(MODEL, list).added).toEqual(["traces: []"]);
    const map = apply({ op: "delete", path: ["joints", "main"] });
    const both = applyEdit(map, { op: "delete", path: ["joints", "pin_a"] }, ORDER);
    expect(both).toContain("    layer: 1\n\njoints: {}\n\ntraces:");
  });

  it("removes a whole section without leaving a double gap", () => {
    const result = apply({ op: "delete", path: ["joints"] });
    expect(result).toContain("    layer: 1\n\ntraces: [crank.A]\n");
  });

  it("does nothing when the entry is not there", () => {
    expect(apply({ op: "delete", path: ["params", "nothing"] })).toBe(MODEL);
    expect(apply({ op: "delete", path: ["drivers", "motor"] })).toBe(MODEL);
  });
});

describe("text that cannot be patched in place", () => {
  it("still makes the change and keeps comments when replacing a map written in lines", () => {
    const result = apply({ op: "set", path: ["params"], value: { r: "10 mm" } });
    expect(result).toContain("# A model with comments");
    expect(result).toContain("r: 10 mm");
    expect(result).not.toContain("rpm");
  });

  it("refuses text with a syntax error", () => {
    expect(() => applyEdit("a: [1, 2\n", { op: "set", path: ["b"], value: 1 })).toThrow(EditError);
  });
});
