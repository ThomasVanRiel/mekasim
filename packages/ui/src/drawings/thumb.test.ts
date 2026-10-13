import { circleLoop, nest, parsePath } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { thumbOf } from "./thumb.ts";

describe("the picture of a layer", () => {
  const outlines = nest([...parsePath("M 10 20 L 50 20 L 50 40 L 10 40 Z"), circleLoop(20, 30, 4)]);

  it("holds the outlines with their holes, in a box with y upwards", () => {
    const thumb = thumbOf(outlines, [], 0.1);
    expect(thumb?.closed).toContain("M 10 20 L 50 20");
    expect(thumb?.closed.match(/M /g)).toHaveLength(2);
    expect(thumb?.open).toBe("");
    // 40 wide and 20 high, with a tenth of the longer side round it.
    expect(thumb?.viewBox).toBe("6 -44 48 28");
  });

  it("draws what does not close as lines, and makes room for it", () => {
    const thumb = thumbOf(outlines, [
      {
        from: [60, 20],
        to: [80, 40],
        gap: 28,
        segments: [
          { kind: "line", ax: 60, ay: 20, bx: 80, by: 20 },
          { kind: "line", ax: 80, ay: 20, bx: 80, by: 40 },
        ],
      },
    ]);
    expect(thumb?.open).toBe("M60 20L80 20L80 40");
    expect(Number(thumb?.viewBox.split(" ")[2])).toBeGreaterThan(70);
  });

  it("is nothing when the layer is empty", () => {
    expect(thumbOf([], [])).toBeUndefined();
  });
});
