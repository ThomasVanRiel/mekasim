import { type Part, slotOutline } from "@mekasim/core";
import { ExtrudeGeometry, Group, Mesh, Path, Shape, Vector2 } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

/** Printing programs take STL sizes as millimetres. */
const MM = 1000;

/**
 * Parts as one binary STL: each part as a flat plate of the given thickness with
 * its holes and slots cut through, lying on the print bed as laid out.
 * Sizes in, metres; sizes out, millimetres.
 */
export function toStl(parts: Part[], thickness: number): ArrayBuffer {
  const group = new Group();
  for (const part of parts) {
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
    const geometry = new ExtrudeGeometry(shape, {
      depth: thickness * MM,
      bevelEnabled: false,
      curveSegments: 32,
    });
    group.add(new Mesh(geometry));
  }
  const data = new STLExporter().parse(group, { binary: true });
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
