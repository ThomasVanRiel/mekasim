import { docFactor, LENGTH, type Units } from "../expr/units.ts";
import type { Point } from "../geometry/outline.ts";
import { type Part, slotOutline } from "./parts.ts";

/** DXF codes for the unit of a drawing. */
const INSUNITS: Record<Units["length"], number> = { in: 1, mm: 4, cm: 5, m: 6 };

/**
 * Parts as a DXF drawing, in the model's length unit. Written in the old and plain
 * R12 form, which cutting and CAD programs read without fuss. Outlines are on the
 * layer `outline`, holes and slots on `holes`, and the part names on `names`, so
 * that a cutting program can treat them differently or leave the names out.
 */
export function toDxf(
  parts: Part[],
  units: Units,
  names: (id: string) => string = (id) => id,
): string {
  const scale = docFactor(LENGTH, units);
  const number = (value: number): string => {
    const rounded = Number((value / scale).toFixed(4));
    return (rounded === 0 ? 0 : rounded).toString();
  };
  const lines: (string | number)[] = [];
  const add = (...pairs: (string | number)[]): void => {
    lines.push(...pairs);
  };

  function polygon(layer: string, points: Point[]): void {
    add(0, "POLYLINE", 8, layer, 66, 1, 70, 1);
    for (const [x, y] of points) add(0, "VERTEX", 8, layer, 10, number(x), 20, number(y));
    add(0, "SEQEND");
  }

  add(0, "SECTION", 2, "HEADER");
  add(9, "$ACADVER", 1, "AC1009");
  add(9, "$INSUNITS", 70, INSUNITS[units.length]);
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");
  for (const part of parts) {
    polygon("outline", part.outline);
    for (const hole of part.holes) {
      add(
        0,
        "CIRCLE",
        8,
        "holes",
        10,
        number(hole.x),
        20,
        number(hole.y),
        40,
        number(hole.diameter / 2),
      );
    }
    for (const slot of part.slots) polygon("holes", slotOutline(slot));

    // The name stands to the right of the part, clear of what is cut.
    const right = Math.max(...part.outline.map((p) => p[0]));
    const low = Math.min(...part.outline.map((p) => p[1]));
    const high = Math.max(...part.outline.map((p) => p[1]));
    const height = Math.max((high - low) * 0.3, scale);
    add(
      0,
      "TEXT",
      8,
      "names",
      10,
      number(right + height),
      20,
      number((low + high) / 2 - height / 2),
    );
    add(40, number(height), 1, names(part.id));
  }
  add(0, "ENDSEC", 0, "EOF");
  return `${lines.join("\n")}\n`;
}
