import {
  endOf,
  insideLoop,
  type Loop,
  lengthOf,
  loopArea,
  type Point,
  reverseLoop,
  type Segment,
  startOf,
} from "@mekasim/core";

const TURN = 2 * Math.PI;

/** Segments that join end to end without coming back to where they started. */
export interface OpenChain {
  from: Point;
  to: Point;
  /** How far apart its two ends are. */
  gap: number;
  segments: Segment[];
}

export interface Chained {
  closed: Loop[];
  open: OpenChain[];
  /** Segments left out: those of no length, and those drawn twice. */
  dropped: number;
}

function reversed(segment: Segment): Segment {
  return reverseLoop({ segments: [segment] }).segments[0] as Segment;
}

/** A place along a segment, to tell two segments between the same ends apart. */
function middle(segment: Segment): Point {
  if (segment.kind === "line") {
    return [(segment.ax + segment.bx) / 2, (segment.ay + segment.by) / 2];
  }
  const angle = segment.start + segment.sweep / 2;
  return [segment.cx + segment.r * Math.cos(angle), segment.cy + segment.r * Math.sin(angle)];
}

/**
 * Join loose segments, as a drawing gives them, into outlines. Ends within
 * `tolerance` of each other are one place. What does not close is given back as
 * open chains with their ends, for the report. A place where three or more
 * segments meet ends the chains that reach it.
 */
export function chain(segments: Segment[], tolerance: number): Chained {
  const closed: Loop[] = [];
  let dropped = 0;

  // Places, found with a grid as fine as the tolerance: a place and its neighbours' cells.
  const cells = new Map<string, number[]>();
  const places: Point[] = [];
  function placeOf([x, y]: Point): number {
    const cx = Math.floor(x / tolerance);
    const cy = Math.floor(y / tolerance);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of cells.get(`${cx + dx} ${cy + dy}`) ?? []) {
          const [px, py] = places[id] as Point;
          if (Math.hypot(px - x, py - y) <= tolerance) return id;
        }
      }
    }
    const id = places.push([x, y]) - 1;
    const key = `${cx} ${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), id]);
    return id;
  }

  interface Edge {
    segment: Segment;
    a: number;
    b: number;
    used: boolean;
  }
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (segment.kind === "arc" && Math.abs(segment.sweep) >= TURN - 1e-9) {
      // A whole circle is an outline by itself.
      const key = `circle ${placeOf([segment.cx, segment.cy])} ${Math.round(segment.r / tolerance)}`;
      if (seen.has(key)) dropped++;
      else {
        seen.add(key);
        closed.push({ segments: [segment] });
      }
      continue;
    }
    if (lengthOf(segment) <= tolerance) {
      dropped++;
      continue;
    }
    const a = placeOf(startOf(segment));
    const b = placeOf(endOf(segment));
    const key = `${Math.min(a, b)} ${Math.max(a, b)} ${placeOf(middle(segment))}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    edges.push({ segment, a, b, used: false });
  }

  const at = new Map<number, Edge[]>();
  for (const edge of edges) {
    for (const place of [edge.a, edge.b]) at.set(place, [...(at.get(place) ?? []), edge]);
  }
  const degree = (place: number): number => {
    const meeting = at.get(place) ?? [];
    // An edge from a place back to itself meets it twice.
    return meeting.reduce((sum, edge) => sum + (edge.a === edge.b ? 2 : 1), 0);
  };

  /** Follow the drawing from a place along an edge until it branches, ends or comes back. */
  function walk(from: number, first: Edge): { segments: Segment[]; end: number } {
    const out: Segment[] = [];
    let place = from;
    let edge: Edge | undefined = first;
    while (edge) {
      edge.used = true;
      const forward = edge.a === place;
      out.push(forward ? edge.segment : reversed(edge.segment));
      place = forward ? edge.b : edge.a;
      if (place === from || degree(place) !== 2) break;
      edge = (at.get(place) ?? []).find((next) => !next.used);
    }
    return { segments: out, end: place };
  }

  const open: OpenChain[] = [];
  // First the chains that start at a loose end or where the drawing branches.
  for (const [place, meeting] of at) {
    if (degree(place) === 2) continue;
    for (const edge of meeting) {
      if (edge.used) continue;
      const { segments: found, end } = walk(place, edge);
      if (end === place) closed.push({ segments: found });
      else {
        const from = places[place] as Point;
        const to = places[end] as Point;
        open.push({ from, to, gap: Math.hypot(to[0] - from[0], to[1] - from[1]), segments: found });
      }
    }
  }
  // What is left goes round without a branch.
  for (const edge of edges) {
    if (!edge.used) closed.push({ segments: walk(edge.a, edge).segments });
  }
  return { closed, open, dropped };
}

/** An outline with the holes that lie directly inside it. */
export interface Nested {
  /** Anticlockwise. */
  outer: Loop;
  /** Clockwise. */
  holes: Loop[];
  /** Area of the outline, holes not taken off. */
  area: number;
}

/**
 * Sort closed loops into outlines and their holes by which lies inside which: a
 * loop inside an even number of others is an outline, one inside an odd number a
 * hole of the smallest loop round it. The largest outline comes first, so a drawing
 * exported again lists its outlines in the same order.
 */
export function nest(loops: Loop[]): Nested[] {
  const sized = loops
    .map((loop) => ({ loop, area: Math.abs(loopArea(loop)), signed: loopArea(loop) }))
    .sort((a, b) => b.area - a.area);
  const outlines: (Nested & { depth: number })[] = [];
  const found: { item: (typeof sized)[number]; depth: number; nested?: Nested }[] = [];
  for (const item of sized) {
    const [x, y] = startOf(item.loop.segments[0] as Segment);
    // Larger loops come first, so everything that can hold this one is already placed.
    const around = found.filter((other) => insideLoop(other.item.loop, x, y));
    const depth = around.length;
    const entry: (typeof found)[number] = { item, depth };
    if (depth % 2 === 0) {
      const nested = {
        outer: item.signed < 0 ? reverseLoop(item.loop) : item.loop,
        holes: [],
        area: item.area,
        depth,
      };
      entry.nested = nested;
      outlines.push(nested);
    } else {
      // The smallest loop round it is the last one found, and it is an outline.
      const parent = around.at(-1)?.nested;
      parent?.holes.push(item.signed > 0 ? reverseLoop(item.loop) : item.loop);
    }
    found.push(entry);
  }
  return outlines.map(({ outer, holes, area }) => ({ outer, holes, area }));
}
