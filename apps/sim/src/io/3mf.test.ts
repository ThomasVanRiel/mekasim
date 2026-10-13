import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { buildParts, type Fabrication, layoutParts, simulate } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { to3mf } from "./3mf.ts";
import { zip } from "./zip.ts";

const SIZES: Fabrication = { width: 0.02, thickness: 0.005, hole: 0.006, clearance: 0 };

function parts(name: string) {
  const text = readFileSync(
    new URL(`../../../../examples/${name}.mekasim.yaml`, import.meta.url),
    "utf8",
  );
  return layoutParts(buildParts(simulate(text), SIZES), 0.005);
}

/**
 * The files of a zip by path, read as a program opening it would: from the
 * directory at its end to each file, checking what the two say against each other.
 */
function unzip(data: ArrayBuffer): Map<string, string> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const decoder = new TextDecoder();
  const end = data.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let listed = view.getUint32(end + 16, true);
  expect(listed + view.getUint32(end + 12, true)).toBe(end);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(listed, true)).toBe(0x02014b50);
    expect(view.getUint16(listed + 10, true)).toBe(0);
    const size = view.getUint32(listed + 24, true);
    const nameLength = view.getUint16(listed + 28, true);
    const at = view.getUint32(listed + 42, true);
    const name = decoder.decode(bytes.subarray(listed + 46, listed + 46 + nameLength));
    expect(view.getUint32(at, true)).toBe(0x04034b50);
    // The file's own header says the same as the directory.
    expect(bytes.subarray(at + 4, at + 28)).toEqual(bytes.subarray(listed + 6, listed + 30));
    expect(decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))).toBe(name);
    const content = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(view.getUint32(listed + 16, true)).toBe(crc32(content));
    files.set(name, decoder.decode(content));
    listed += 46 + nameLength;
  }
  expect(listed).toBe(end);
  return files;
}

interface Solid {
  name: string;
  vertices: number[][];
  triangles: number[][];
}

/** The objects of a 3MF file, each with its corners and triangles. */
function objects(file: ArrayBuffer): Solid[] {
  const model = unzip(file).get("3D/3dmodel.model") ?? "";
  expect(model).toContain('unit="millimeter"');
  const solids = [
    ...model.matchAll(/<object id="(\d+)" type="model" name="([^"]*)">(.*?)<\/object>/gs),
  ];
  // Every object is put on the bed once.
  expect([...model.matchAll(/<item objectid="(\d+)"\/>/g)].map((item) => item[1])).toEqual(
    solids.map((solid) => solid[1]),
  );
  return solids.map((solid) => ({
    name: solid[2] as string,
    vertices: [...(solid[3] as string).matchAll(/<vertex x="(.*?)" y="(.*?)" z="(.*?)"\/>/g)].map(
      (vertex) => vertex.slice(1).map(Number),
    ),
    triangles: [
      ...(solid[3] as string).matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
    ].map((triangle) => triangle.slice(1).map(Number)),
  }));
}

/** Volume enclosed by a solid's triangles, counted positive where they face outwards. */
function volume({ vertices, triangles }: Solid): number {
  let total = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((corner) => vertices[corner]) as [number[], number[], number[]];
    total +=
      ((a[0] as number) *
        ((b[1] as number) * (c[2] as number) - (b[2] as number) * (c[1] as number)) -
        (a[1] as number) *
          ((b[0] as number) * (c[2] as number) - (b[2] as number) * (c[0] as number)) +
        (a[2] as number) *
          ((b[0] as number) * (c[1] as number) - (b[1] as number) * (c[0] as number))) /
      6;
  }
  return total;
}

/** Whether every edge joins two triangles that run along it in opposite directions. */
function closed({ triangles }: Solid): boolean {
  const edges = new Map<string, number>();
  for (const [a, b, c] of triangles as [number, number, number][]) {
    for (const edge of [`${a} ${b}`, `${b} ${c}`, `${c} ${a}`]) {
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  return [...edges].every(
    ([edge, count]) => count === 1 && edges.get(edge.split(" ").reverse().join(" ")) === 1,
  );
}

describe("zip", () => {
  it("holds its files as written, also with letters beyond ASCII", () => {
    const files = unzip(
      zip([
        { path: "a.txt", text: "one" },
        { path: "map/b é.txt", text: "twee – ü" },
        { path: "empty", text: "" },
      ]),
    );
    expect([...files]).toEqual([
      ["a.txt", "one"],
      ["map/b é.txt", "twee – ü"],
      ["empty", ""],
    ]);
  });
});

describe("to3mf", () => {
  it("is a 3MF package", () => {
    const files = unzip(to3mf(parts("four-bar"), SIZES.thickness));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    expect(files.get("_rels/.rels")).toContain('Target="/3D/3dmodel.model"');
  });

  it("holds every part as an object of its own, by name", () => {
    const pieces = parts("four-bar");
    const solids = objects(to3mf(pieces, SIZES.thickness, (id) => `<${id}> & "co"`));
    expect(solids.map((solid) => solid.name)).toEqual(
      pieces.map((part) => `&lt;${part.id}&gt; &amp; &quot;co&quot;`),
    );
  });

  it("makes each a solid of the right size, in millimetres, holes cut through", () => {
    const crank = parts("four-bar").filter((p) => p.id === "crank");
    const [solid] = objects(to3mf(crank, SIZES.thickness)) as [Solid];
    // A 40 x 20 mm link with round ends, less two 6 mm holes, 5 mm thick.
    const face = 40 * 20 + Math.PI * 10 ** 2 - 2 * Math.PI * 3 ** 2;
    expect(volume(solid) / (face * 5)).toBeCloseTo(1, 2);
  });

  it.each(["four-bar", "slider-crank", "strandbeest"])("closes every solid of %s", (name) => {
    const pieces = parts(name);
    const solids = objects(to3mf(pieces, SIZES.thickness));
    expect(solids).toHaveLength(pieces.length);
    for (const solid of solids) {
      expect(closed(solid), solid.name).toBe(true);
      expect(volume(solid)).toBeGreaterThan(0);
      const heights = solid.vertices.map((vertex) => vertex[2] as number);
      expect(Math.min(...heights)).toBe(0);
      expect(Math.max(...heights)).toBe(5);
    }
  });

  it("leaves the parts where they are laid out on the bed", () => {
    const pieces = parts("four-bar");
    const solids = objects(to3mf(pieces, SIZES.thickness));
    pieces.forEach((part, i) => {
      const xs = part.outline.map(([x]) => x * 1000);
      const found = (solids[i] as Solid).vertices.map((vertex) => vertex[0] as number);
      expect(Math.min(...found)).toBeCloseTo(Math.min(...xs), 3);
      expect(Math.max(...found)).toBeCloseTo(Math.max(...xs), 3);
    });
  });
});
