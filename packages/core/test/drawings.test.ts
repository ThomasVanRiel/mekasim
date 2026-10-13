import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  circleLoop,
  drawingFiles,
  drawingName,
  keepOutlines,
  loopArea,
  readDrawing,
  type Shape,
  shapeOf,
  shapesToDxf,
  simulate as simulateModel,
} from "../src/index.ts";

const simulate = (text: string, files?: Map<string, string>) => simulateModel(text, { files });

const read = (path: string): string =>
  readFileSync(new URL(`../../../examples/${path}`, import.meta.url), "utf8");
/** The example as it is saved: with the outlines of its drawing kept in it. */
const saved = read("shaped-four-bar-dxf.mekasim.yaml");
/** The same as it is first written, before any outline is kept: what needs its drawing. */
const model = saved.replace(/, path: [^}]*\}/g, " }");
const dxf = read("four-bar-links.dxf");
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
        'The drawing "four-bar-links.dxf" is not attached, so "crank", "coupler", "rocker" are drawn without their shapes. Add it under Geometry',
        18,
      ],
    ]);
    expect(simulation.missing).toEqual(["four-bar-links.dxf"]);
    expect(simulation.unshaped).toEqual(["crank", "coupler", "rocker"]);
    expect(simulate(model, files).missing).toEqual([]);
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
      '"four-bar-links.dxf" does not say what unit it is drawn in. Pick it under Geometry, or add it here, as in unit: mm',
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

  it("takes how closely curves are replaced by arcs from the model", () => {
    const withFit = (fit: string) =>
      model.replace("{ file: four-bar-links.dxf }", `{ file: four-bar-links.dxf, fit: ${fit} }`);
    expect(simulate(model, files).drawings.get("links")?.fit).toBe(2e-6);
    const coarse = simulate(withFit("0.05 mm"), files);
    expect(coarse.diagnostics).toEqual([]);
    expect(coarse.drawings.get("links")?.fit).toBeCloseTo(5e-5, 15);
    // Without a unit of its own it is in the model's unit of length.
    expect(simulate(withFit("0.01"), files).drawings.get("links")?.fit).toBeCloseTo(1e-5, 15);
    expect(said(withFit("0"))[0]).toEqual([
      "error",
      'fit is how far the arcs may lie from a curve, and has to be more than zero. Found "0"',
      "geometry.links.fit",
    ]);
    expect(said(withFit("r / 100"))[0]?.[1]).toBe(
      '"r" cannot be used here: fit is written as a length in "r / 100"',
    );
  });

  it("says where curves were replaced by arcs", () => {
    const oval = [
      "0\nSECTION\n2\nENTITIES",
      "0\nELLIPSE\n8\nOVAL\n10\n0\n20\n0\n11\n30\n21\n0\n40\n0.5",
      "0\nENDSEC\n0\nEOF\n",
    ].join("\n");
    const drawing = readDrawing("oval.dxf", oval, "mm");
    expect(drawing.open).toEqual([]);
    expect(drawing.layers.get("OVAL")).toHaveLength(1);
    expect(drawing.fitted).toEqual([
      {
        layer: "OVAL",
        curves: 1,
        segments: drawing.layers.get("OVAL")?.[0]?.outer.segments.length,
      },
    ]);
    expect(readDrawing("oval.dxf", oval, "mm", 1e-4).fitted[0]?.segments).toBeLessThan(
      drawing.fitted[0]?.segments as number,
    );
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

describe("a model that keeps the outlines of its drawings", () => {
  const bare = model;
  const kept = keepOutlines(bare, files);

  it("is the example itself, as it is saved", () => {
    expect(bare).not.toBe(saved);
    expect(kept).toBe(saved);
  });

  it("has each outline beside what says where it comes from", () => {
    expect(bare).not.toContain("path:");
    expect(kept).toContain("geometry:");
    expect(kept).toMatch(/shape: \{ from: links, layer: CRANK, place: \[20, 20, 0\], path: M /);
    // The rest of the text is as it was written, comments and all.
    expect(kept).toContain("# crank radius");
  });

  it("runs the same without its drawing, and has nothing to say about it", () => {
    const alone = simulate(kept);
    expect(alone.diagnostics).toEqual([]);
    expect(alone.missing).toEqual(["four-bar-links.dxf"]);
    expect(alone.unshaped).toEqual([]);
    const withFiles = simulate(kept, files);
    for (const id of ["crank", "coupler", "rocker"]) {
      const a = shapeOfBody(alone, id) as Shape;
      const b = shapeOfBody(withFiles, id) as Shape;
      expect(loopArea(a.outer)).toBeCloseTo(loopArea(b.outer), 12);
      expect(a.holes).toHaveLength(b.holes.length);
    }
  });

  it("follows the drawing when it is there, whatever outline is kept", () => {
    const stale = kept.replace(/layer: CRANK, place: \[20, 20, 0\], path: [^}]*\}/, (found) =>
      found.replace(/path: [^}]*\}/, "path: M 0 0 L 1 0 L 1 1 Z }"),
    );
    expect(stale).not.toBe(kept);
    // With the drawing, the crank is the drawing's; without it, what the model keeps.
    expect(loopArea((shapeOfBody(simulate(stale, files), "crank") as Shape).outer)).toBeGreaterThan(
      1e-4,
    );
    expect(loopArea((shapeOfBody(simulate(stale), "crank") as Shape).outer)).toBeCloseTo(
      0.5e-6,
      12,
    );
    // Saved with the drawing at hand, the kept outline is the drawing's again.
    expect(keepOutlines(stale, files)).toBe(kept);
  });

  it("is left as it is when there is nothing to keep, or the drawing is not there", () => {
    expect(keepOutlines(kept, files)).toBe(kept);
    expect(keepOutlines(bare)).toBe(bare);
    const text = read("four-bar.mekasim.yaml");
    expect(keepOutlines(text)).toBe(text);
    expect(keepOutlines("bodies: [")).toBe("bodies: [");
  });

  it("names the files a model needs, for whoever fetches them", () => {
    expect(drawingFiles(model)).toEqual(["four-bar-links.dxf"]);
    expect(drawingFiles("bodies: [")).toEqual([]);
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

describe("what a model says of its drawings", () => {
  it("is kept for showing: what is named, and which body uses which layer", () => {
    const simulation = simulate(model, files);
    expect(simulation.sources).toEqual({ links: { file: "four-bar-links.dxf" } });
    expect(simulation.uses.map(({ path, ...use }) => use)).toEqual([
      { body: "crank", from: "links", layer: "CRANK", byPoint: false, kept: false },
      { body: "coupler", from: "links", layer: "COUPLER", byPoint: false, kept: false },
      { body: "rocker", from: "links", layer: "ROCKER", byPoint: false, kept: false },
    ]);
    // Also when the drawing is not there.
    expect(simulate(model).uses).toHaveLength(3);
  });

  it("names a drawing after its file", () => {
    expect(drawingName("four-bar-links.dxf", [])).toBe("four_bar_links");
    expect(drawingName("parts/Coupler head.DXF", [])).toBe("coupler_head");
    expect(drawingName("links.dxf", ["links", "links_2"])).toBe("links_3");
    expect(drawingName("2024 plate.dxf", [])).toBe("drawing_2024_plate");
    expect(drawingName(".dxf", [])).toBe("drawing");
  });
});
