import {
  arcBetween,
  type Loop,
  type Placement,
  type Point,
  placeLoop,
  type Segment,
} from "@mekasim/core";

/** Metres to one drawing unit, by the code a DXF file gives for its unit. */
const INSUNITS: Record<number, number> = {
  1: 0.0254,
  2: 0.3048,
  4: 0.001,
  5: 0.01,
  6: 1,
  8: 0.0000000254,
  9: 0.0000254,
  10: 0.9144,
  13: 0.000001,
  14: 0.1,
};

/** What a drawing file holds, before its segments are joined into outlines. */
export interface RawDrawing {
  /** Metres to one unit of the drawing, when the file says. */
  unit?: number;
  /** The segments on each layer, in the order of the file. */
  layers: Map<string, Segment[]>;
  /** What was left out, by kind: text, dimensions, hatches, curves not read yet. */
  skipped: Map<string, number>;
}

interface Pair {
  code: number;
  value: string;
}

interface Entity {
  type: string;
  pairs: Pair[];
}

function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  if (lines.length < 2 && Number.isNaN(Number.parseInt((lines[0] ?? "").trim(), 10)))
    lines.push("");
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] as string).trim(), 10);
    if (Number.isNaN(code)) {
      throw new Error(
        `This is not a text DXF file: line ${i + 1} should be a group code and is "${(lines[i] as string).trim().slice(0, 20)}". Binary DXF and DWG are not read; export as ASCII DXF`,
      );
    }
    pairs.push({ code, value: (lines[i + 1] as string).trim() });
  }
  return pairs;
}

const DEG = Math.PI / 180;

/**
 * Read an ASCII DXF file: lines, arcs, circles and polylines, with blocks put in
 * where they are inserted. Text, dimensions and hatches are counted and left out.
 */
export function readDxf(text: string): RawDrawing {
  const pairs = pairsOf(text);
  const drawing: RawDrawing = { layers: new Map(), skipped: new Map() };
  const blocks = new Map<string, { base: Point; entities: Entity[] }>();
  const top: Entity[] = [];

  let section = "";
  let block: { name: string; base: Point; entities: Entity[] } | undefined;
  let variable = "";
  let entity: Entity | undefined;
  /** A polyline of the old kind, whose corners follow as entities of their own. */
  let polyline: Entity | undefined;

  function finish(): void {
    if (!entity) return;
    const done = entity;
    entity = undefined;
    if (done.type === "VERTEX" && polyline) {
      // Kept on the polyline as its corners: a place, and how the side after it bulges.
      for (const pair of done.pairs) {
        if (pair.code === 10 || pair.code === 20 || pair.code === 42) polyline.pairs.push(pair);
      }
      return;
    }
    if (done.type === "SEQEND") {
      polyline = undefined;
      return;
    }
    if (done.type === "POLYLINE") polyline = done;
    (block ? block.entities : top).push(done);
  }

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i] as Pair;
    if (code === 0) {
      finish();
      if (value === "SECTION") {
        section = pairs[i + 1]?.value ?? "";
        i++;
      } else if (value === "ENDSEC") section = "";
      else if (value === "EOF") break;
      else if (section === "BLOCKS" && value === "BLOCK")
        block = { name: "", base: [0, 0], entities: [] };
      else if (section === "BLOCKS" && value === "ENDBLK") {
        if (block) blocks.set(block.name, block);
        block = undefined;
      } else if (section === "ENTITIES" || (section === "BLOCKS" && block)) {
        entity = { type: value, pairs: [] };
      }
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) variable = value;
      else if (variable === "$INSUNITS" && code === 70) drawing.unit = INSUNITS[Number(value)];
      continue;
    }
    if (entity) entity.pairs.push({ code, value });
    else if (block) {
      if (code === 2) block.name = value;
      else if (code === 10) block.base = [Number(value), block.base[1]];
      else if (code === 20) block.base = [block.base[0], Number(value)];
    }
  }
  finish();

  const skip = (kind: string): void => {
    drawing.skipped.set(kind, (drawing.skipped.get(kind) ?? 0) + 1);
  };

  function emit(
    entities: Entity[],
    placements: Placement[],
    insertLayer: string | undefined,
    depth: number,
  ): void {
    for (const { type, pairs: fields } of entities) {
      const number = (code: number, otherwise = 0): number => {
        const found = fields.find((pair) => pair.code === code);
        return found ? Number(found.value) : otherwise;
      };
      const own = fields.find((pair) => pair.code === 8)?.value ?? "0";
      // What a block draws on layer 0 takes the layer the block is inserted on.
      const layer = own === "0" && insertLayer !== undefined ? insertLayer : own;
      // Drawn on the back of the sheet: seen from the front, mirrored left to right.
      const flipped = number(230, 1) < 0;
      const segments: Segment[] = [];

      if (type === "LINE") {
        const from: Point = [number(10), number(20)];
        const to: Point = [number(11), number(21)];
        if (from[0] !== to[0] || from[1] !== to[1]) {
          segments.push({ kind: "line", ax: from[0], ay: from[1], bx: to[0], by: to[1] });
        }
      } else if (type === "CIRCLE") {
        segments.push({
          kind: "arc",
          cx: number(10),
          cy: number(20),
          r: number(40),
          start: 0,
          sweep: 2 * Math.PI,
        });
      } else if (type === "ARC") {
        const start = number(50) * DEG;
        let sweep = (number(51) * DEG - start) % (2 * Math.PI);
        if (sweep <= 0) sweep += 2 * Math.PI;
        segments.push({ kind: "arc", cx: number(10), cy: number(20), r: number(40), start, sweep });
      } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
        const corners: { at: Point; bulge: number }[] = [];
        // A polyline of the old kind carries a place of its own first, which is not a corner.
        let ownPlace = type === "POLYLINE";
        for (const { code, value } of fields) {
          if (code === 10) {
            if (ownPlace) ownPlace = false;
            else corners.push({ at: [Number(value), 0], bulge: 0 });
          } else if (code === 20 && corners.length > 0)
            (corners.at(-1) as { at: Point }).at[1] = Number(value);
          else if (code === 42 && corners.length > 0)
            (corners.at(-1) as { bulge: number }).bulge = Number(value);
        }
        const closed = (number(70) & 1) === 1;
        const sides = closed ? corners.length : corners.length - 1;
        for (let k = 0; k < sides; k++) {
          const { at: from, bulge } = corners[k] as { at: Point; bulge: number };
          const to = (corners[(k + 1) % corners.length] as { at: Point }).at;
          if (from[0] === to[0] && from[1] === to[1]) continue;
          if (bulge === 0) {
            segments.push({ kind: "line", ax: from[0], ay: from[1], bx: to[0], by: to[1] });
          } else {
            // The bulge is the tangent of a quarter of the angle the side turns through.
            const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
            const r = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
            segments.push(arcBetween(from, to, r, Math.abs(bulge) > 1, bulge > 0));
          }
        }
      } else if (type === "INSERT") {
        const name = fields.find((pair) => pair.code === 2)?.value ?? "";
        const inserted = blocks.get(name);
        const sx = number(41, 1);
        const sy = number(42, 1);
        if (!inserted || depth > 16) skip("blocks that could not be found");
        else if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9 * Math.abs(sx) || sx === 0) {
          // Stretched one way more than the other, its arcs would no longer be arcs.
          skip("blocks stretched unevenly");
        } else {
          const mirror = sx * sy < 0;
          const angle = number(50) * DEG + (sy < 0 ? Math.PI : 0);
          const inner: Placement[] = [
            { x: -inserted.base[0], y: -inserted.base[1] },
            { scale: Math.abs(sx), mirror, angle, x: number(10), y: number(20) },
            ...placements,
          ];
          emit(inserted.entities, inner, layer, depth + 1);
        }
        continue;
      } else {
        skip(type);
        continue;
      }

      let loop: Loop = { segments };
      if (flipped) loop = placeLoop(loop, { mirror: true });
      for (const placement of placements) loop = placeLoop(loop, placement);
      const onLayer = drawing.layers.get(layer) ?? [];
      onLayer.push(...loop.segments);
      drawing.layers.set(layer, onLayer);
    }
  }

  emit(top, [], undefined, 0);
  return drawing;
}
