import { type Part, slotOutline } from "@mekasim/core";
import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";

/** Printing programs take sizes as millimetres. */
const MM = 1000;

/**
 * A part as a flat plate of the given thickness with its holes and slots cut
 * through, lying on the print bed as laid out.
 * Sizes in, metres; sizes out, millimetres.
 */
export function plate(part: Part, thickness: number): ExtrudeGeometry {
  const shape = new Shape(part.outline.map(([x, y]) => new Vector2(x * MM, y * MM)));
  for (const hole of part.holes) {
    const path = new Path();
    path.absarc(hole.x * MM, hole.y * MM, (hole.diameter / 2) * MM, 0, 2 * Math.PI, true);
    shape.holes.push(path);
  }
  for (const slot of part.slots) {
    // A hole runs the other way round than the outline.
    const outline = slotOutline(slot).reverse();
    shape.holes.push(new Path(outline.map(([x, y]) => new Vector2(x * MM, y * MM))));
  }
  for (const cutout of part.cutouts) {
    shape.holes.push(new Path(cutout.map(([x, y]) => new Vector2(x * MM, y * MM))));
  }
  return new ExtrudeGeometry(shape, {
    depth: thickness * MM,
    bevelEnabled: false,
    curveSegments: 32,
  });
}
