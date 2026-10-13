/** Geometry of the sheet's view: where the world lies on the screen. No drawing here. */

/**
 * What part of the world the sheet shows. The world is in metres with y upwards;
 * the screen in pixels with y downwards.
 */
export interface View {
  /** The world point at the middle of the sheet. */
  x: number;
  y: number;
  /** Pixels per metre. */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A box in the world, in metres. */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** From a hair's breadth filling the sheet to a kilometre across it. */
const MIN_SCALE = 1;
const MAX_SCALE = 1e7;

export function toScreen(view: View, size: Size, x: number, y: number): [number, number] {
  return [size.width / 2 + (x - view.x) * view.scale, size.height / 2 - (y - view.y) * view.scale];
}

export function toWorld(view: View, size: Size, sx: number, sy: number): [number, number] {
  return [
    view.x + (sx - size.width / 2) / view.scale,
    view.y - (sy - size.height / 2) / view.scale,
  ];
}

/** The view after the sheet is dragged by a number of pixels: the world moves with the pointer. */
export function panned(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x - dx / view.scale, y: view.y + dy / view.scale };
}

/** The view after zooming by `factor`, with the world point under the pointer staying under it. */
export function zoomed(view: View, size: Size, sx: number, sy: number, factor: number): View {
  const scale = Math.min(Math.max(view.scale * factor, MIN_SCALE), MAX_SCALE);
  const [x, y] = toWorld(view, size, sx, sy);
  return {
    x: x - (sx - size.width / 2) / scale,
    y: y + (sy - size.height / 2) / scale,
    scale,
  };
}

/** The view that shows all of a box, with a margin round it as a share of the sheet. */
export function fitted(box: Box, size: Size, margin = 0.08): View {
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const room = 1 - 2 * margin;
  const scale = Math.min((size.width * room) / width, (size.height * room) / height);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    scale: Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE),
  };
}

/** The SVG transform that draws world coordinates at their place on the screen. */
export function worldTransform(view: View, size: Size): string {
  const { scale } = view;
  const tx = size.width / 2 - view.x * scale;
  const ty = size.height / 2 + view.y * scale;
  return `matrix(${scale} 0 0 ${-scale} ${tx} ${ty})`;
}

/** The part of the world that is on the sheet. */
export function visible(view: View, size: Size): Box {
  const [minX, maxY] = toWorld(view, size, 0, 0);
  const [maxX, minY] = toWorld(view, size, size.width, size.height);
  return { minX, maxX, minY, maxY };
}
