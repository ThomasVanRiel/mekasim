import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FitCompiled, load, simulate } from "../src/index.ts";

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
    expect(result.diagnostics).toEqual([]);
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
