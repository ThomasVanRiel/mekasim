import {
  circleLoop,
  endOf,
  type Loop,
  loopArea,
  loopBounds,
  parsePath,
  type Segment,
  startOf,
} from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { readDxf } from "../src/import/dxf.ts";
import { chain, nest } from "../src/import/loops.ts";

const line = (ax: number, ay: number, bx: number, by: number): Segment => ({
  kind: "line",
  ax,
  ay,
  bx,
  by,
});

/** The sides of a box, in no order and pointing every which way, as a drawing has them. */
function boxSides(x: number, y: number, w: number, h: number): Segment[] {
  return [
    line(x + w, y, x + w, y + h),
    line(x, y, x + w, y),
    line(x, y + h, x + w, y + h),
    line(x, y + h, x, y),
  ];
}

function expectClosed(loop: Loop): void {
  loop.segments.forEach((segment, i) => {
    const next = loop.segments[(i + 1) % loop.segments.length] as Segment;
    expect(
      Math.hypot(endOf(segment)[0] - startOf(next)[0], endOf(segment)[1] - startOf(next)[1]),
    ).toBeLessThan(1e-6);
  });
}

describe("joining loose segments into outlines", () => {
  it("joins sides in any order and direction into one outline", () => {
    const { closed, open, dropped } = chain(boxSides(0, 0, 10, 5), 1e-6);
    expect([closed.length, open.length, dropped]).toEqual([1, 0, 0]);
    expectClosed(closed[0] as Loop);
    expect(Math.abs(loopArea(closed[0] as Loop))).toBe(50);
  });

  it("joins ends that are a hair apart, and no more than that", () => {
    const sides = boxSides(0, 0, 10, 5);
    sides[0] = line(10 + 4e-7, 0, 10, 5);
    expect(chain(sides, 1e-6).closed).toHaveLength(1);
    sides[0] = line(10.01, 0, 10, 5);
    const { closed, open } = chain(sides, 1e-6);
    expect(closed).toHaveLength(0);
    // One chain of all four sides, whose two ends do not meet.
    expect(open.map((found) => found.segments.length)).toEqual([4]);
    expect(open[0]?.gap).toBeCloseTo(0.01, 12);
  });

  it("reports what does not close, with its ends", () => {
    const { closed, open } = chain(boxSides(0, 0, 10, 5).slice(0, 3), 1e-6);
    expect(closed).toHaveLength(0);
    expect(open).toHaveLength(1);
    expect(open[0]?.segments).toHaveLength(3);
    expect(open[0]?.gap).toBe(5);
    expect([open[0]?.from, open[0]?.to].map((p) => p?.join(" ")).sort()).toEqual(["0 0", "0 5"]);
  });

  it("drops what is drawn twice and what has no length", () => {
    const { closed, dropped } = chain(
      [
        ...boxSides(0, 0, 10, 5),
        line(10, 0, 0, 0),
        line(3, 3, 3, 3),
        ...circleLoop(2, 2, 1).segments,
        ...circleLoop(2, 2, 1, false).segments,
      ],
      1e-6,
    );
    expect(closed).toHaveLength(2);
    expect(dropped).toBe(3);
  });

  it("keeps an arc and a line between the same two ends apart", () => {
    const half: Segment = { kind: "arc", cx: 5, cy: 0, r: 5, start: Math.PI, sweep: -Math.PI };
    const { closed, dropped } = chain([line(0, 0, 10, 0), half], 1e-6);
    expect(dropped).toBe(0);
    expect(closed).toHaveLength(1);
    expect(Math.abs(loopArea(closed[0] as Loop))).toBeCloseTo((Math.PI * 25) / 2, 10);
  });

  it("ends chains where the drawing branches", () => {
    // A box with a line sticking out of one corner.
    const { closed, open } = chain([...boxSides(0, 0, 10, 5), line(10, 5, 15, 9)], 1e-6);
    expect(closed).toHaveLength(1);
    expect(open).toHaveLength(1);
    expect(open[0]?.segments).toHaveLength(1);
  });

  it("takes two outlines apart", () => {
    const { closed } = chain([...boxSides(0, 0, 10, 5), ...boxSides(20, 0, 4, 4)], 1e-6);
    expect(closed.map((loop) => Math.abs(loopArea(loop))).sort((a, b) => a - b)).toEqual([16, 50]);
  });
});

describe("sorting outlines and holes", () => {
  it("puts holes in the outline round them, largest outline first", () => {
    const loops = [
      ...parsePath("M 20 0 L 24 0 L 24 4 L 20 4 Z"),
      circleLoop(3, 3, 1, false),
      ...parsePath("M 0 0 L 0 10 L 10 10 L 10 0 Z"),
      circleLoop(7, 7, 1),
    ];
    const nested = nest(loops);
    expect(nested.map((n) => [n.area, n.holes.length])).toEqual([
      [100, 2],
      [16, 0],
    ]);
    expect(loopArea(nested[0]?.outer as Loop)).toBe(100);
    expect(nested[0]?.holes.map((hole) => Math.sign(loopArea(hole)))).toEqual([-1, -1]);
  });

  it("takes an island in a hole as an outline of its own", () => {
    const nested = nest([circleLoop(0, 0, 10), circleLoop(0, 0, 6), circleLoop(0, 0, 2)]);
    expect(nested.map((n) => n.holes.length)).toEqual([1, 0]);
    expect(nested[1]?.area).toBeCloseTo(Math.PI * 4, 10);
  });
});

/** DXF text from group codes and values. */
function dxf(...groups: (string | number)[]): string {
  return `${groups.join("\n")}\n`;
}
const entities = (...groups: (string | number)[]): string =>
  dxf(0, "SECTION", 2, "ENTITIES", ...groups, 0, "ENDSEC", 0, "EOF");
const lineEntity = (layer: string, ax: number, ay: number, bx: number, by: number) => [
  0,
  "LINE",
  8,
  layer,
  10,
  ax,
  20,
  ay,
  11,
  bx,
  21,
  by,
];

describe("reading DXF", () => {
  it("reads lines by layer", () => {
    const drawing = readDxf(
      entities(
        ...lineEntity("HEAD", 0, 0, 10, 0),
        ...lineEntity("KNUCKLE", 1, 1, 2, 2),
        ...lineEntity("HEAD", 10, 0, 10, 5),
      ),
    );
    expect([...drawing.layers.keys()]).toEqual(["HEAD", "KNUCKLE"]);
    expect(drawing.layers.get("HEAD")).toEqual([line(0, 0, 10, 0), line(10, 0, 10, 5)]);
    expect(drawing.unit).toBeUndefined();
  });

  it("reads the unit the file gives", () => {
    const text =
      dxf(
        0,
        "SECTION",
        2,
        "HEADER",
        9,
        "$ACADVER",
        1,
        "AC1015",
        9,
        "$INSUNITS",
        70,
        4,
        0,
        "ENDSEC",
      ) + entities(...lineEntity("0", 0, 0, 1, 0));
    expect(readDxf(text).unit).toBe(0.001);
  });

  it("reads arcs anticlockwise from their start angle, and circles", () => {
    const drawing = readDxf(
      entities(
        0,
        "ARC",
        8,
        "A",
        10,
        5,
        20,
        5,
        40,
        2,
        50,
        270,
        51,
        90,
        0,
        "CIRCLE",
        8,
        "A",
        10,
        1,
        20,
        2,
        40,
        3,
      ),
    );
    const [arc, circle] = drawing.layers.get("A") as (Segment & { kind: "arc" })[];
    expect(arc?.sweep).toBeCloseTo(Math.PI, 12);
    expect(endOf(arc as Segment)[1]).toBeCloseTo(7, 12);
    expect(circle).toEqual({ kind: "arc", cx: 1, cy: 2, r: 3, start: 0, sweep: 2 * Math.PI });
  });

  it("reads a closed polyline with bulging sides", () => {
    // A slot: straight below, a half circle at the right, straight above, a half circle at the left.
    const drawing = readDxf(
      entities(
        0,
        "LWPOLYLINE",
        8,
        "SLOT",
        90,
        4,
        70,
        1,
        10,
        0,
        20,
        -5,
        10,
        20,
        20,
        -5,
        42,
        1,
        10,
        20,
        20,
        5,
        10,
        0,
        20,
        5,
        42,
        1,
      ),
    );
    const { closed } = chain(drawing.layers.get("SLOT") as Segment[], 1e-9);
    expect(closed).toHaveLength(1);
    expect(loopArea(closed[0] as Loop)).toBeCloseTo(200 + Math.PI * 25, 10);
    expect(loopBounds(closed[0] as Loop).maxX).toBeCloseTo(25, 10);
  });

  it("reads a polyline of the old kind, corner by corner", () => {
    const drawing = readDxf(
      entities(
        0,
        "POLYLINE",
        8,
        "P",
        66,
        1,
        10,
        0,
        20,
        0,
        70,
        1,
        0,
        "VERTEX",
        8,
        "P",
        10,
        0,
        20,
        0,
        0,
        "VERTEX",
        8,
        "P",
        10,
        4,
        20,
        0,
        0,
        "VERTEX",
        8,
        "P",
        10,
        4,
        20,
        3,
        0,
        "SEQEND",
        ...lineEntity("P", 9, 9, 8, 8),
      ),
    );
    const segments = drawing.layers.get("P") as Segment[];
    expect(segments).toHaveLength(4);
    expect(Math.abs(loopArea({ segments: segments.slice(0, 3) }))).toBe(6);
  });

  it("puts a block in where it is inserted: moved, turned, scaled and mirrored", () => {
    const blocks = dxf(
      0,
      "SECTION",
      2,
      "BLOCKS",
      0,
      "BLOCK",
      8,
      "0",
      2,
      "TAB",
      70,
      0,
      10,
      1,
      20,
      0,
      ...lineEntity("0", 1, 0, 3, 0),
      0,
      "ARC",
      8,
      "0",
      10,
      3,
      20,
      1,
      40,
      1,
      50,
      270,
      51,
      0,
      0,
      "ENDBLK",
      0,
      "ENDSEC",
    );
    const drawing = readDxf(
      blocks +
        entities(
          0,
          "INSERT",
          8,
          "PARTS",
          2,
          "TAB",
          10,
          100,
          20,
          50,
          50,
          90,
          0,
          "INSERT",
          8,
          "PARTS",
          2,
          "TAB",
          10,
          0,
          20,
          0,
          41,
          -2,
          42,
          2,
        ),
    );
    const [turnedLine, turnedArc, mirroredLine, mirroredArc] = drawing.layers.get(
      "PARTS",
    ) as Segment[];
    // Turned a quarter anticlockwise about the block's own point (1, 0), put at (100, 50).
    expect(endOf(turnedLine as Segment)[0]).toBeCloseTo(100, 10);
    expect(endOf(turnedLine as Segment)[1]).toBeCloseTo(52, 10);
    expect(endOf(turnedArc as Segment)[0]).toBeCloseTo(99, 10);
    expect(endOf(turnedArc as Segment)[1]).toBeCloseTo(53, 10);
    // Twice the size and mirrored left to right: the arc now goes clockwise.
    expect(endOf(mirroredLine as Segment)[0]).toBeCloseTo(-4, 10);
    expect((mirroredArc as Segment & { kind: "arc" }).r).toBeCloseTo(2, 10);
    expect((mirroredArc as Segment & { kind: "arc" }).sweep).toBeLessThan(0);
    expect(endOf(mirroredArc as Segment)[0]).toBeCloseTo(-6, 10);
    expect(endOf(mirroredArc as Segment)[1]).toBeCloseTo(2, 10);
  });

  it("counts what it leaves out", () => {
    const drawing = readDxf(
      entities(
        0,
        "TEXT",
        8,
        "0",
        10,
        0,
        20,
        0,
        1,
        "A note",
        0,
        "DIMENSION",
        8,
        "0",
        0,
        "TEXT",
        8,
        "0",
        10,
        0,
        20,
        0,
        1,
        "Another",
        0,
        "SPLINE",
        8,
        "0",
        0,
        "INSERT",
        8,
        "0",
        2,
        "MISSING",
        ...lineEntity("0", 0, 0, 1, 0),
      ),
    );
    expect(Object.fromEntries(drawing.skipped)).toEqual({
      TEXT: 2,
      DIMENSION: 1,
      SPLINE: 1,
      "blocks that could not be found": 1,
    });
    expect(drawing.layers.get("0")).toHaveLength(1);
  });

  it("reads lines ending in CR LF, and says when a file is not a text DXF", () => {
    const text = entities(...lineEntity("0", 0, 0, 1, 0)).replaceAll("\n", "\r\n");
    expect(readDxf(text).layers.get("0")).toHaveLength(1);
    expect(() => readDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(
      "This is not a text DXF file",
    );
  });

  it("mirrors what was drawn on the back of the sheet", () => {
    const drawing = readDxf(
      entities(0, "ARC", 8, "A", 10, 5, 20, 0, 40, 1, 50, 0, 51, 90, 230, -1),
    );
    const arc = (drawing.layers.get("A") as (Segment & { kind: "arc" })[])[0];
    expect(arc?.cx).toBeCloseTo(-5, 12);
    expect(startOf(arc as Segment)[0]).toBeCloseTo(-6, 12);
    expect(endOf(arc as Segment)[1]).toBeCloseTo(1, 12);
  });
});
