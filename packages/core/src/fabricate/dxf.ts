import { docFactor, LENGTH, type Units } from "../expr/units.ts";
import { convexHull, type Point } from "../geometry/outline.ts";
import { GROUND } from "../schema/document.ts";
import type { Simulation } from "../simulate.ts";
import { type Part, slotOutline } from "./parts.ts";

/** DXF codes for the unit of a drawing. */
const INSUNITS: Record<Units["length"], number> = { in: 1, mm: 4, cm: 5, m: 6 };

/**
 * A DXF drawing in the model's length unit, to be filled with entities. Written in
 * the old and plain R12 form, which cutting and CAD programs read without fuss.
 * `header` is group codes for the header beyond the version and the unit.
 */
function drawing(units: Units, header: (string | number)[] = []) {
  const scale = docFactor(LENGTH, units);
  const number = (value: number): string => {
    const rounded = Number((value / scale).toFixed(4));
    return (rounded === 0 ? 0 : rounded).toString();
  };
  const lines: (string | number)[] = [];
  const add = (...pairs: (string | number)[]): void => {
    lines.push(...pairs);
  };

  add(0, "SECTION", 2, "HEADER");
  add(9, "$ACADVER", 1, "AC1009");
  add(9, "$INSUNITS", 70, INSUNITS[units.length]);
  add(...header);
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");

  return {
    scale,
    number,
    add,
    polygon(layer: string, points: Point[]): void {
      add(0, "POLYLINE", 8, layer, 66, 1, 70, 1);
      for (const [x, y] of points) add(0, "VERTEX", 8, layer, 10, number(x), 20, number(y));
      add(0, "SEQEND");
    },
    text(layer: string, x: number, y: number, height: number, content: string): void {
      add(0, "TEXT", 8, layer, 10, number(x), 20, number(y), 40, number(height), 1, content);
    },
    finish(): string {
      add(0, "ENDSEC", 0, "EOF");
      return `${lines.join("\n")}\n`;
    },
  };
}

/**
 * Parts as a DXF drawing, in the model's length unit. Outlines are on the layer
 * `outline`, holes and slots on `holes`, and the part names on `names`, so that a
 * cutting program can treat them differently or leave the names out.
 */
export function toDxf(
  parts: Part[],
  units: Units,
  names: (id: string) => string = (id) => id,
): string {
  const { scale, number, add, polygon, text, finish } = drawing(units);
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
    for (const cutout of part.cutouts) polygon("holes", cutout);

    // The name stands to the right of the part, clear of what is cut.
    const right = Math.max(...part.outline.map((p) => p[0]));
    const low = Math.min(...part.outline.map((p) => p[1]));
    const high = Math.max(...part.outline.map((p) => p[1]));
    const height = Math.max((high - low) * 0.3, scale);
    text("names", right + height, (low + high) / 2 - height / 2, height, names(part.id));
  }
  return finish();
}

/**
 * The mechanism as it stands at the start of the cycle, as a DXF drawing in the
 * model's length unit, to build on in a CAD program. Every point a joint sits on is
 * a point on the layer `joints`, and the other points of the links are on `points`.
 * Each link is drawn through its points on `links` and the ground on `ground`, as
 * lines to go by. The names of the joints and points are on `names`.
 */
export function toPointsDxf(
  simulation: Simulation,
  names: (id: string) => string = (id) => id,
): string {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || cycle.count === 0) return "";

  const placed = new Map<string, Point>();
  const frames = new Map<string, Point[]>();
  for (const body of compiled.bodies.values()) {
    const at = 3 * body.index;
    const [x, y, phi] =
      body.index < 0 ? [0, 0, 0] : [cycle.q[at], cycle.q[at + 1], cycle.q[at + 2]];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const frame: Point[] = [];
    for (const [name, { u, v }] of body.points) {
      const point: Point = [x + u * c - v * s, y + u * s + v * c];
      placed.set(`${body.id}.${name}`, point);
      frame.push(point);
    }
    frames.set(body.id, frame);
  }

  // Names and point marks are sized to the drawing, so that they can be read and do not crowd it.
  const all = [...placed.values()];
  const span = (axis: 0 | 1): number =>
    all.length === 0
      ? 0
      : Math.max(...all.map((p) => p[axis])) - Math.min(...all.map((p) => p[axis]));
  const unit = docFactor(LENGTH, compiled.units);
  const height = Math.max(span(0), span(1), 100 * unit) * 0.015;

  // Points are drawn as a circle with a cross, where the program reading this allows it.
  const { number, add, polygon, text, finish } = drawing(compiled.units, [
    9,
    "$PDMODE",
    70,
    34,
    9,
    "$PDSIZE",
    40,
    Number((height / unit).toFixed(4)),
  ]);

  for (const [id, frame] of frames) {
    const layer = id === GROUND ? "ground" : "links";
    const hull = convexHull(frame);
    const [from, to] = hull;
    if (hull.length > 2) polygon(layer, hull);
    else if (from && to) {
      add(0, "LINE", 8, layer, 10, number(from[0]), 20, number(from[1]));
      add(11, number(to[0]), 21, number(to[1]));
    }
  }

  // Points that share a place, as the two ends of a pin do, are one point in the drawing.
  const seen = new Set<string>();
  const mark = (layer: string, [x, y]: Point, name: string): void => {
    const key = `${number(x)},${number(y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    add(0, "POINT", 8, layer, 10, number(x), 20, number(y));
    text("names", x + height, y + height, height, name);
  };
  for (const joint of compiled.joints) {
    for (const ref of joint.points) {
      const point = placed.get(ref);
      if (point) mark("joints", point, names(joint.id));
    }
  }
  for (const body of compiled.bodies.values()) {
    for (const name of body.points.keys()) {
      mark("points", placed.get(`${body.id}.${name}`) as Point, `${names(body.id)} ${name}`);
    }
  }
  return finish();
}
