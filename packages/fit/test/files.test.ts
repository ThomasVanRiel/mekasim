import { readFileSync } from "node:fs";
import {
  circleLoop,
  loopArea,
  type Shape,
  shapeOf,
  simulate as simulateModel,
} from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { asMekasim, flatten, readDrawing, shapesToDxf, simulate } from "../src/index.ts";

const read = (path: string): string =>
  readFileSync(new URL(`../../../examples/${path}`, import.meta.url), "utf8");
const model = read("fit/four-bar-from-drawing.mekafit.yaml");
const dxf = read("fit/four-bar-links.dxf");
const files = new Map([["four-bar-links.dxf", dxf]]);
const written = simulateModel(read("shaped-four-bar.mekasim.yaml"));

const shapeOfBody = (simulation: ReturnType<typeof simulate>, id: string): Shape | undefined =>
  simulation.compiled?.bodies.get(id)?.shape;
const said = (text: string, attached = files) =>
  simulate(text, attached).diagnostics.map((d) => [d.severity, d.message, d.path?.join(".")]);

describe("shapes from a drawing", () => {
  const simulation = simulate(model, files);

  it("land on their bodies as the shapes written out do", () => {
    expect(simulation.diagnostics).toEqual([]);
    for (const id of ["crank", "coupler", "rocker"]) {
      const drawn = shapeOfBody(simulation, id) as Shape;
      const same = written.compiled?.bodies.get(id)?.shape as Shape;
      expect(loopArea(drawn.outer)).toBeCloseTo(loopArea(same.outer), 12);
      expect(drawn.holes).toHaveLength(same.holes.length);
      for (const side of ["minX", "maxX", "minY", "maxY"] as const) {
        expect(drawn.bounds[side]).toBeCloseTo(same.bounds[side], 9);
      }
    }
  });

  it("leave the motion as it is", () => {
    expect(simulation.cycle?.q).toEqual(written.cycle?.q);
    expect(simulation.checks).toMatchObject([{ holds: true }]);
  });

  it("come with what the drawing holds, for the report", () => {
    const drawing = simulation.drawings.get("links");
    expect(drawing?.unit).toBe(0.001);
    expect([...(drawing?.layers.keys() ?? [])]).toEqual(["CRANK", "COUPLER", "ROCKER"]);
    expect(drawing?.layers.get("COUPLER")?.map((outline) => outline.holes.length)).toEqual([3]);
    expect(drawing?.open).toEqual([]);
  });
});

describe("a drawing that is not there, or not as the model says", () => {
  it("leaves the model running without its shapes, and says so once", () => {
    const simulation = simulate(model);
    expect(simulation.diagnostics.map((d) => [d.severity, d.message, d.position?.line])).toEqual([
      [
        "warning",
        'The drawing "four-bar-links.dxf" is not attached, so the shapes from it are left out',
        16,
      ],
    ]);
    expect(simulation.cycle?.count).toBe(360);
    expect(shapeOfBody(simulation, "crank")).toBeUndefined();
  });

  it("names the layers there are when one is not found", () => {
    expect(said(model.replace("layer: CRANK", "layer: HANDLE"))).toEqual([
      [
        "error",
        '"four-bar-links.dxf" has no layer "HANDLE". Its layers are "CRANK", "COUPLER", "ROCKER"',
        "bodies.crank.shape.layer",
      ],
    ]);
  });

  it("asks which outline is meant when there are several", () => {
    const [, message, path] = said(model.replace("layer: CRANK, ", ""))[0] ?? [];
    expect(message).toBe(
      '"four-bar-links.dxf" has 3 outlines. Say which with layer, or with at: [x, y], a point inside the one that is meant',
    );
    expect(path).toBe("bodies.crank.shape");
  });

  it("picks the outline round a point", () => {
    // A point in the crank's bar, between its two holes.
    const picked = simulate(model.replace("layer: CRANK, ", "at: [40, 20], "), files);
    expect(picked.diagnostics).toEqual([]);
    const same = written.compiled?.bodies.get("crank")?.shape as Shape;
    expect(loopArea((shapeOfBody(picked, "crank") as Shape).outer)).toBeCloseTo(
      loopArea(same.outer),
      12,
    );
    expect(said(model.replace("layer: CRANK, ", "at: [500, 500], "))[0]?.[1]).toBe(
      'No closed outline of "four-bar-links.dxf" has the point (500, 500) inside it',
    );
  });

  it("wants a drawing that is named, and a place written in numbers", () => {
    expect(
      said(model.replace("from: links, layer: CRANK", "from: parts, layer: CRANK"))[0]?.[1],
    ).toBe('There is no drawing "parts" under geometry');
    expect(said(model.replace("place: [20, 20, 0]", "place: [r, 20, 0]"))[0]?.[1]).toBe(
      '"r" cannot be used here: a place in a drawing is written in numbers in "r"',
    );
  });

  it("wants to know the unit, from the file or from the model", () => {
    const silent = new Map([
      ["four-bar-links.dxf", dxf.replace("$INSUNITS\n70\n4\n", "$INSUNITS\n70\n0\n")],
    ]);
    expect(said(model, silent)[0]?.[1]).toBe(
      '"four-bar-links.dxf" does not say what unit it is drawn in. Add it here, as in unit: mm',
    );
    const told = model.replace(
      "{ file: four-bar-links.dxf }",
      "{ file: four-bar-links.dxf, unit: mm }",
    );
    expect(simulate(told, silent).diagnostics).toEqual([]);
    // Read as inches, the links come out 25.4 times the size.
    const inches = simulate(told.replace("unit: mm", "unit: in"), silent);
    expect((shapeOfBody(inches, "rocker") as Shape).bounds.maxX).toBeCloseTo(0.119 * 25.4, 9);
  });

  it("says where an outline is open", () => {
    // Without its first line the crank's outline no longer closes.
    const cut = dxf.replace(
      /0\nLINE\n8\nCRANK\n10\n[^\n]*\n20\n[^\n]*\n11\n[^\n]*\n21\n[^\n]*\n/,
      "",
    );
    expect(cut).not.toBe(dxf);
    const [, message] = said(model, new Map([["four-bar-links.dxf", cut]]))[0] ?? [];
    expect(message).toMatch(
      /^An outline on layer "CRANK" of "four-bar-links.dxf" is not closed: it is open between \(/,
    );
  });

  it("says what is wrong with a file that is not a drawing", () => {
    expect(said(model, new Map([["four-bar-links.dxf", "not a drawing"]]))[0]?.[1]).toContain(
      "This is not a text DXF file",
    );
    const svg = model.replace("{ file: four-bar-links.dxf }", "{ file: links.svg }");
    expect(said(svg, new Map([["links.svg", "<svg/>"]]))[0]?.[1]).toBe(
      '"links.svg" is not a DXF file. Other drawings, such as SVG, are not read yet',
    );
  });
});

describe("a model made complete without its files", () => {
  const flat = flatten(model, files) as string;

  it("has its shapes written out, and no drawings named", () => {
    expect(flat).not.toContain("geometry:");
    expect(flat).not.toContain("from: links");
    expect(flat).toContain("path: M ");
    // The rest of the text is as it was written, comments and all.
    expect(flat).toContain("# crank radius");
  });

  it("gives the same shapes, with no files at hand", () => {
    const alone = simulate(flat);
    expect(alone.diagnostics).toEqual([]);
    const withFiles = simulate(model, files);
    for (const id of ["crank", "coupler", "rocker"]) {
      const a = shapeOfBody(alone, id) as Shape;
      const b = shapeOfBody(withFiles, id) as Shape;
      expect(loopArea(a.outer)).toBeCloseTo(loopArea(b.outer), 12);
      expect(a.holes).toHaveLength(b.holes.length);
    }
  });

  it("opens in mekasim, having nothing else of mekafit's", () => {
    const plain = asMekasim(flat) as string;
    expect(simulateModel(plain).diagnostics).toEqual([]);
    expect(asMekasim(model)).toBeUndefined();
  });

  it("is the text itself when there is nothing to write out", () => {
    const text = read("four-bar.mekasim.yaml");
    expect(flatten(text)).toBe(text);
    expect(flatten("bodies: [")).toBeUndefined();
  });
});

describe("shapes written as a drawing", () => {
  it("come back as the same outlines", () => {
    const plate = shapeOf(
      [
        {
          segments: [
            { kind: "line", ax: 0, ay: -0.005, bx: 0.02, by: -0.005 },
            { kind: "arc", cx: 0.02, cy: 0, r: 0.005, start: -Math.PI / 2, sweep: Math.PI },
            { kind: "line", ax: 0.02, ay: 0.005, bx: 0, by: 0.005 },
            { kind: "arc", cx: 0, cy: 0, r: 0.005, start: Math.PI / 2, sweep: Math.PI },
          ],
        },
        circleLoop(0, 0, 0.002),
      ],
      1e-9,
    );
    for (const unit of ["mm", "in"] as const) {
      const drawing = readDrawing(
        "plate.dxf",
        shapesToDxf([{ layer: "PLATE", shape: plate }], unit),
      );
      expect(drawing.unit).toBe(unit === "mm" ? 0.001 : 0.0254);
      const [outline] = drawing.layers.get("PLATE") ?? [];
      const scale = (drawing.unit as number) ** 2;
      expect((outline?.area ?? 0) * scale).toBeCloseTo(loopArea(plate.outer), 12);
      expect(outline?.holes).toHaveLength(1);
      expect(drawing.open).toEqual([]);
    }
  });
});
