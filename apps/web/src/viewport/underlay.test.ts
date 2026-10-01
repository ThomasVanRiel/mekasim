import { describe, expect, it } from "vitest";
import { placeUnderlay, rescaleUnderlay } from "./underlay.ts";

const image = { url: "blob:x", width: 2000, height: 1000 };
const bounds = { minX: 0, maxX: 1, minY: -0.2, maxY: 0.2 };

describe("underlay", () => {
  it("starts centred on the model and a little wider than it", () => {
    const underlay = placeUnderlay(image, bounds);
    expect(underlay).toMatchObject({ x: 0.5, y: 0 });
    expect(underlay.scale * image.width).toBeCloseTo(1.2, 12);
  });

  it("is resized so that two picked places are a known distance apart", () => {
    const before = placeUnderlay(image, bounds);
    // Two places 0.3 m apart on the sheet are really 0.6 m apart.
    const after = rescaleUnderlay(before, { x: 0.2, y: 0.1 }, { x: 0.5, y: 0.1 }, 0.6);
    expect(after.scale).toBeCloseTo(before.scale * 2, 12);
    // The first place has not moved: it is the same pixel of the picture as before.
    const pixel = (u: typeof before) => (0.2 - u.x) / u.scale;
    expect(pixel(after)).toBeCloseTo(pixel(before), 9);
    // The second place has moved to 0.6 m from the first.
    const second = after.x + ((0.5 - before.x) / before.scale) * after.scale;
    expect(second - 0.2).toBeCloseTo(0.6, 12);
  });

  it("ignores a distance that makes no sense", () => {
    const before = placeUnderlay(image, bounds);
    expect(rescaleUnderlay(before, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBe(before);
    expect(rescaleUnderlay(before, { x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBe(before);
  });
});
