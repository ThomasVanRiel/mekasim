import { type Box, emptyBox, type Segment, type Shape, segmentBounds } from "@mekasim/core";

/**
 * The segments of a shape sorted into boxes within boxes, so that a search for what
 * is near can leave out whole parts of the shape at once.
 */
export interface Tree {
  box: Box;
  /** The middle of the box, and how far its corners are from it. */
  cx: number;
  cy: number;
  r: number;
  /** The segments in the box, when it is not divided further. */
  segments?: Segment[];
  left?: Tree;
  right?: Tree;
}

/** The most segments a box holds before it is divided. */
const LEAF = 2;

function node(items: { segment: Segment; box: Box }[]): Tree {
  const box = emptyBox();
  for (const item of items) {
    box.minX = Math.min(box.minX, item.box.minX);
    box.maxX = Math.max(box.maxX, item.box.maxX);
    box.minY = Math.min(box.minY, item.box.minY);
    box.maxY = Math.max(box.maxY, item.box.maxY);
  }
  const tree: Tree = {
    box,
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    r: Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2,
  };
  if (items.length <= LEAF) {
    tree.segments = items.map((item) => item.segment);
    return tree;
  }
  // Halved along the way the box is longer, by where the segments' own boxes lie.
  const wide = box.maxX - box.minX >= box.maxY - box.minY;
  const middle = (item: { box: Box }): number =>
    wide ? item.box.minX + item.box.maxX : item.box.minY + item.box.maxY;
  const sorted = [...items].sort((a, b) => middle(a) - middle(b));
  const half = sorted.length >> 1;
  tree.left = node(sorted.slice(0, half));
  tree.right = node(sorted.slice(half));
  return tree;
}

/** The tree of loose segments. */
export function treeOfSegments(segments: Segment[]): Tree {
  return node(segments.map((segment) => ({ segment, box: segmentBounds(segment) })));
}

const trees = new WeakMap<Shape, Tree>();

/** The tree of a shape's outline and holes together. It is made once for each shape. */
export function treeOf(shape: Shape): Tree {
  let tree = trees.get(shape);
  if (!tree) {
    tree = treeOfSegments([shape.outer, ...shape.holes].flatMap((loop) => loop.segments));
    trees.set(shape, tree);
  }
  return tree;
}

/** How far a point is from a box; nothing when it is in it. */
export function boxDistance(box: Box, x: number, y: number): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dy = Math.max(box.minY - y, 0, y - box.maxY);
  return Math.hypot(dx, dy);
}
