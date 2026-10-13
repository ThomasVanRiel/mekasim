import { readFileSync } from "node:fs";
import { editText } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import {
  addContacts,
  type FitCompiled,
  findContacts,
  hasContact,
  load,
  simulate,
} from "../src/index.ts";

const example = readFileSync(
  new URL("../../../examples/shaped-four-bar.mekasim.yaml", import.meta.url),
  "utf8",
).replace("mekasim: 1", "mekafit: 1");

function withContacts(contacts: string): string {
  return example.replace("bodies:\n", `contacts:\n${contacts}\nbodies:\n`);
}

describe("contacts in a mekafit model", () => {
  it("reads a pair or a group, but no other form", () => {
    expect(load(withContacts("  close: { between: [crank, rocker] }")).diagnostics).toEqual([]);
    expect(load(withContacts("  close: { among: [crank, coupler, rocker] }")).diagnostics).toEqual(
      [],
    );
    expect(load(withContacts("  close: [crank, rocker]")).diagnostics[0]?.path).toEqual([
      "contacts",
      "close",
    ]);
    expect(
      load(withContacts("  close: { between: [crank, rocker], friction: 0.2 }")).diagnostics,
    ).toHaveLength(1);
  });

  it("expands groups and keeps a pair only once", () => {
    const result = simulate(
      withContacts(
        [
          "  nearby: { among: [crank, coupler, rocker] }",
          "  repeated: { between: [rocker, crank] }",
        ].join("\n"),
      ),
    );
    expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect((result.compiled as FitCompiled).contacts).toEqual([
      { id: "nearby", a: "crank", b: "coupler", path: ["contacts", "nearby"] },
      { id: "nearby", a: "crank", b: "rocker", path: ["contacts", "nearby"] },
      { id: "nearby", a: "coupler", b: "rocker", path: ["contacts", "nearby"] },
    ]);
  });

  it("reports an unknown or unshaped body where its name is written", () => {
    const result = simulate(withContacts("  bad: { among: [crank, ground, missing] }"));
    expect(
      result.diagnostics.map(({ message, path, position }) => [message, path, position?.line]),
    ).toEqual([
      [
        '"ground" has no shape, so it cannot be named in contacts',
        ["contacts", "bad", "among", 1],
        16,
      ],
      ['Unknown body "missing"', ["contacts", "bad", "among", 2], 16],
    ]);
    expect(result.cycle).toBeUndefined();
  });
});

const blocks = `mekafit: 1
meta:
  units: { length: mm, angle: deg }
bodies:
  ground:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 9 2 H 19 V 8 H 9 Z" }
joints:
  fixed: { type: weld, connect: [ground.O, block.O] }
contacts:
  blocks: { between: [ground, block] }
`;

describe("checking contacts after a run", () => {
  it("reports the first meaningful overlap at the contact entry", () => {
    // These axis-aligned rectangles overlap by exactly 1 mm, worked out from x = 9 to x = 10.
    const result = simulate(blocks);
    expect(
      result.diagnostics
        .filter(({ path }) => path?.[0] === "contacts")
        .map(({ severity, message, path, position }) => [severity, message, path, position?.line]),
    ).toEqual([
      ["error", '"ground" runs into "block" at step 0, 1 mm deep', ["contacts", "blocks"], 14],
    ]);
  });

  it("ignores an overlap no deeper than 0.001 mm", () => {
    const hairline = blocks.replace(
      'path: "M 9 2 H 19 V 8 H 9 Z"',
      'path: "M 9.9995 2 H 19 V 8 H 9.9995 Z"',
    );
    expect(
      simulate(hairline).diagnostics.some(({ message }) => message.includes("runs into")),
    ).toBe(false);
  });

  it("uses the same warning as gap() for bodies joined by a pin", () => {
    const pinned = blocks.replace("type: weld", "type: revolute");
    const messages = simulate(pinned)
      .diagnostics.filter(({ path }) => path?.[0] === "contacts")
      .map(({ severity, message }) => [severity, message]);
    expect(messages).toEqual([
      [
        "warning",
        '"ground" and "block" are joined by a pin, so where they lie over each other is not counted, and gap() gives 0 there. To measure the gap between them, draw them clear of each other round the pin',
      ],
    ]);
    expect(messages.some(([, message]) => message?.includes("runs into"))).toBe(false);
  });

  it("keeps the smallest gap, its step and its two places with the run", () => {
    const [contact] = simulate(blocks).contacts;
    expect(contact).toMatchObject({ id: "blocks", a: "ground", b: "block", step: 0 });
    expect(contact?.smallest.distance).toBeCloseTo(-0.001, 12);
    expect(contact?.smallest.a).toEqual([0.01, 0.002]);
    expect(contact?.smallest.b[0]).toBeCloseTo(0.009, 12);
    expect(contact?.smallest.b[1]).toBeCloseTo(0.002, 12);
    expect(contact?.measured.gaps).toHaveLength(1);
  });
});

describe("finding and adding contacts", () => {
  it("checks every shaped pair against a chosen distance and marks those already listed", () => {
    const result = simulate(withContacts("  pinned: { between: [crank, coupler] }"));
    // Three shaped moving bodies make exactly 3 choose 2 = 3 possible pairs.
    const every = findContacts(result, 1);
    expect(every.map(({ a, b }) => [a, b])).toEqual([
      ["crank", "coupler"],
      ["crank", "rocker"],
      ["coupler", "rocker"],
    ]);
    expect(every.map(({ listed }) => listed)).toEqual([true, false, false]);
    expect(findContacts(result, 0).map(({ a, b }) => [a, b])).toEqual([
      ["crank", "coupler"],
      ["coupler", "rocker"],
    ]);
  });

  it("writes selected new pairs and does not write a pair twice", () => {
    const before = simulate(withContacts("  pinned: { between: [crank, coupler] }")).doc;
    if (!before) throw new Error("model did not read");
    expect(hasContact(before, "coupler", "crank")).toBe(true);
    const edits = addContacts(before, [
      ["coupler", "crank"],
      ["crank", "rocker"],
      ["coupler", "rocker"],
    ]);
    expect(edits.map((edit) => edit.path)).toEqual([
      ["contacts", "contact1"],
      ["contacts", "contact2"],
    ]);
    const after = simulate(
      editText(withContacts("  pinned: { between: [crank, coupler] }"), edits),
    );
    expect(after.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect((after.compiled as FitCompiled).contacts).toHaveLength(3);
  });
});
