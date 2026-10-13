import {
  type Box,
  emptyBox,
  endOf,
  flattenLoop,
  loopBounds,
  type Nested,
  type OpenChain,
  type Segment,
  segmentBounds,
  writePath,
} from "@mekasim/core";

/** A small picture of what is on one layer of a drawing, as SVG path data in the drawing's own coordinates. */
export interface Thumb {
  /** The closed outlines with their holes, to fill where they are material. */
  closed: string;
  /** What does not close, to draw as lines. */
  open: string;
  /** The box that holds all of it, with a margin, as an SVG `viewBox` with y turned upwards. */
  viewBox: string;
}

/** Segments that do not close, as a line through their ends, arcs cut into short sides. */
function line(segments: Segment[]): string {
  const last = segments.at(-1);
  if (!last) return "";
  const corners = [...flattenLoop({ segments }, 48), endOf(last)];
  return corners.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("");
}

/**
 * The picture of a layer. Undefined when there is nothing on it to draw. The view
 * box is for a picture drawn with `transform="scale(1 -1)"`, since a drawing has y
 * upwards and SVG has it downwards.
 */
export function thumbOf(outlines: Nested[], open: OpenChain[], margin = 0.06): Thumb | undefined {
  const box: Box = emptyBox();
  for (const outline of outlines) loopBounds(outline.outer, box);
  for (const chain of open) for (const segment of chain.segments) segmentBounds(segment, box);
  if (!Number.isFinite(box.minX)) return undefined;
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-9);
  const pad = size * margin;
  const width = box.maxX - box.minX + 2 * pad;
  const height = box.maxY - box.minY + 2 * pad;
  return {
    closed: outlines.map((outline) => writePath([outline.outer, ...outline.holes])).join(" "),
    open: open.map((chain) => line(chain.segments)).join(""),
    viewBox: `${box.minX - pad} ${-(box.maxY + pad)} ${width} ${height}`,
  };
}
