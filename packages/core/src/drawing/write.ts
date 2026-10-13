import { endOf, type Loop, type Shape, startOf } from "../geometry/shape.ts";

/** DXF codes for the unit of a drawing. */
const INSUNITS: Record<string, number> = { in: 1, mm: 4, cm: 5, m: 6 };
const METRES: Record<string, number> = { in: 0.0254, mm: 0.001, cm: 0.01, m: 1 };

const TURN = 2 * Math.PI;

/** An outline to draw, with the layer it goes on. */
export interface Drawn {
  layer: string;
  /** In metres. */
  shape: Shape;
}

/**
 * Shapes as a DXF drawing with true lines, arcs and circles, each shape on its
 * layer and its holes with it. Written in the plain R12 form. `unit` is the
 * drawing's length unit; the shapes are given in metres.
 */
export function shapesToDxf(shapes: Drawn[], unit: "mm" | "cm" | "m" | "in" = "mm"): string {
  const scale = METRES[unit] as number;
  const number = (value: number): string => {
    const text = Number((value / scale).toPrecision(12)).toString();
    return Math.abs(value / scale) < 1e-12 ? "0" : text;
  };
  const degrees = (angle: number): string => {
    const turned = ((((angle * 360) / TURN) % 360) + 360) % 360;
    return Number(turned.toPrecision(12)).toString();
  };
  const lines: (string | number)[] = [];
  const add = (...pairs: (string | number)[]): void => {
    lines.push(...pairs);
  };

  add(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009");
  add(9, "$INSUNITS", 70, INSUNITS[unit] as number, 0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");
  const draw = (layer: string, loop: Loop): void => {
    for (const segment of loop.segments) {
      if (segment.kind === "line") {
        const [ax, ay] = startOf(segment);
        const [bx, by] = endOf(segment);
        add(0, "LINE", 8, layer, 10, number(ax), 20, number(ay), 11, number(bx), 21, number(by));
      } else if (Math.abs(segment.sweep) > TURN - 1e-9) {
        add(0, "CIRCLE", 8, layer, 10, number(segment.cx), 20, number(segment.cy));
        add(40, number(segment.r));
      } else {
        // An arc in DXF always goes anticlockwise, from its first angle to its second.
        const from = segment.sweep > 0 ? segment.start : segment.start + segment.sweep;
        add(0, "ARC", 8, layer, 10, number(segment.cx), 20, number(segment.cy));
        add(40, number(segment.r), 50, degrees(from), 51, degrees(from + Math.abs(segment.sweep)));
      }
    }
  };
  for (const { layer, shape } of shapes) {
    draw(layer, shape.outer);
    for (const hole of shape.holes) draw(layer, hole);
  }
  add(0, "ENDSEC", 0, "EOF");
  return `${lines.join("\n")}\n`;
}
