/** Where a dimension line and its value are drawn, in pixels. No drawing here. */

export interface DimensionGeometry {
  /** Middle of the text. */
  x: number;
  y: number;
  /** How far the text is turned, in degrees, so that it runs along the line and reads upright. */
  angle: number;
  /** Length of the line on the screen. */
  length: number;
}

/**
 * A value written beside the line from `a` to `b`, `offset` pixels to its side:
 * above a line that runs across, left of one that runs up.
 */
export function dimensionGeometry(
  a: [number, number],
  b: [number, number],
  offset = 10,
): DimensionGeometry {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Text that would hang upside down is turned round to read from the left or from below.
  if (angle >= 90) angle -= 180;
  else if (angle < -90) angle += 180;
  const along = (angle * Math.PI) / 180;
  // Screen y runs downwards, so "up from the text's baseline" is this way.
  return {
    x: (a[0] + b[0]) / 2 + offset * Math.sin(along),
    y: (a[1] + b[1]) / 2 - offset * Math.cos(along),
    angle,
    length,
  };
}
