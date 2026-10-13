/** The grid of the sheet: a spacing that follows the zoom, and where its lines fall. */

/** Every this many lines one is drawn stronger. */
export const MAJOR_EVERY = 5;

/**
 * The spacing of the grid in metres: 1, 2 or 5 times a power of ten document units,
 * the smallest that keeps the lines at least `minPixels` apart. `unit` is the size of
 * a document unit in metres.
 */
export function gridStep(scale: number, unit: number, minPixels = 14): number {
  const wanted = minPixels / scale / unit;
  const power = 10 ** Math.floor(Math.log10(wanted));
  const lead = wanted / power;
  // A hair above a round number is that number, not the next one up.
  const round = [1, 2, 5, 10].find((candidate) => lead <= candidate * (1 + 1e-9)) ?? 10;
  return round * power * unit;
}

export interface GridLine {
  /** Where the line is, in metres. */
  at: number;
  major: boolean;
}

/** The grid lines between two world coordinates. Those through a round fifth are major. */
export function gridLines(from: number, to: number, step: number): GridLine[] {
  const lines: GridLine[] = [];
  const first = Math.ceil(from / step - 1e-9);
  const last = Math.floor(to / step + 1e-9);
  for (let k = first; k <= last; k++) lines.push({ at: k * step, major: k % MAJOR_EVERY === 0 });
  return lines;
}
