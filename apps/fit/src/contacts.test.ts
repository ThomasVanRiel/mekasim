import type { MeasuredGap, Units } from "@mekasim/core";
import type { ContactResult } from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import { contactText, gapsWithContact } from "./contacts.ts";

const units: Units = { length: "mm", angle: "deg" };

describe("a contact result in the interface", () => {
  it("describes clearance, touching and overlap in ordinary words", () => {
    expect(contactText(0.0012, units)).toBe("1.2 mm apart");
    expect(contactText(0, units)).toBe("Touching");
    expect(contactText(-0.0003, units)).toBe("0.3 mm into each other");
  });

  it("draws a hovered contact once even when gap() already asks for that pair", () => {
    const first = { a: "head", b: "knuckle", gaps: [] } as unknown as MeasuredGap;
    const other = { a: "head", b: "lock", gaps: [] } as unknown as MeasuredGap;
    const hovered = {
      a: "knuckle",
      b: "head",
      measured: { a: "knuckle", b: "head", gaps: [] },
    } as unknown as ContactResult;
    expect(gapsWithContact([first, other], hovered)).toEqual([other, hovered.measured]);
    expect(gapsWithContact([first], undefined)).toEqual([first]);
  });
});
