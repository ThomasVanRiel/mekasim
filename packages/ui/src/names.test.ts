import { describe, expect, it } from "vitest";
import { label, refLabel, titled } from "./names.ts";

describe("label", () => {
  it("turns a name from the model into words", () => {
    expect(label("upper_deck")).toBe("Upper deck");
    expect(label("rocker_swing")).toBe("Rocker swing");
    expect(label("upper_peak_g")).toBe("Upper peak g");
    expect(label("ecc")).toBe("Ecc");
  });

  it("sets a counter apart from its word", () => {
    expect(label("link1")).toBe("Link 1");
    expect(label("dist12")).toBe("Dist 12");
    expect(label("deck_position_1")).toBe("Deck position 1");
  });

  it("leaves point names as they are", () => {
    expect(label("A")).toBe("A");
    expect(label("G1")).toBe("G1");
    expect(label("O2")).toBe("O2");
    expect(label("Top")).toBe("Top");
  });

  it("keeps capitals the author chose", () => {
    expect(label("deck_B")).toBe("Deck B");
    expect(label("_hidden")).toBe("Hidden");
  });
});

describe("refLabel", () => {
  it("names the body in words and keeps the point", () => {
    expect(refLabel("upper_deck.F")).toBe("Upper deck F");
    expect(refLabel("ground.G1")).toBe("Ground G1");
    expect(refLabel("link2.B")).toBe("Link 2 B");
    expect(refLabel("rocker")).toBe("Rocker");
  });
});

describe("titled", () => {
  it("puts the kind before the name unless the name already says it", () => {
    expect(titled("Link", "link1")).toBe("Link 1");
    expect(titled("Link", "upper_deck")).toBe("Link Upper deck");
    expect(titled("Pin", "pin3")).toBe("Pin 3");
    expect(titled("Crank", "eccentric")).toBe("Crank Eccentric");
    expect(titled("Motor", "motor")).toBe("Motor");
  });
});
