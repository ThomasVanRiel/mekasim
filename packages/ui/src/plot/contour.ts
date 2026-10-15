/**
 * The share of runs that passed around each place of a study's scatter, and the lines
 * where it crosses a level: a smoothed picture of where a mechanism passes.
 */

/** A run as the smoothing sees it: where it lies on the two axes, and whether it passed. */
export interface PassSample {
  x: number;
  y: number;
  passed: boolean;
}

/** The share passed on a grid over both axes, with how many runs each value rests on. */
export interface PassField {
  /** The grid's places along each axis, from low to high. */
  xs: number[];
  ys: number[];
  /** The share passed at each place, row by row (`ys` outer, `xs` inner); NaN where no run reaches. */
  share: Float64Array;
  /** The weighted count of runs behind each share: about how many runs lie near it. */
  weight: Float64Array;
}

export interface PassFieldOptions {
  /** Places along each axis. */
  cells?: number;
  /**
   * How far a run reaches, as a share of each axis's range. By default it narrows as runs
   * are added, so that about the same picture comes out of 100 runs as of 2000, sharper.
   */
  width?: number;
}

/** How far a run reaches by default, for this many runs spread over both axes. */
export function defaultWidth(runs: number): number {
  // Scott's rule in two dimensions, for runs spread evenly over each range.
  return Math.max(runs, 1) ** (-1 / 6) / Math.sqrt(12);
}

function places(low: number, high: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => low + ((high - low) * i) / (count - 1));
}

/**
 * The share passed around each place of a grid over the two ranges: the runs' passes
 * averaged with weights that fall off with distance as a bell curve.
 */
export function passField(
  samples: PassSample[],
  xRange: [number, number],
  yRange: [number, number],
  options: PassFieldOptions = {},
): PassField {
  const cells = Math.max(2, options.cells ?? 40);
  const width = options.width ?? defaultWidth(samples.length);
  const xs = places(xRange[0], xRange[1], cells);
  const ys = places(yRange[0], yRange[1], cells);
  const xWidth = width * (xRange[1] - xRange[0] || 1);
  const yWidth = width * (yRange[1] - yRange[0] || 1);
  const share = new Float64Array(cells * cells);
  const weight = new Float64Array(cells * cells);
  const used = samples.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      let passed = 0;
      let total = 0;
      for (const sample of used) {
        const dx = (sample.x - xs[i]) / xWidth;
        const dy = (sample.y - ys[j]) / yWidth;
        // Past three widths a run adds nothing worth counting.
        if (dx > 3 || dx < -3 || dy > 3 || dy < -3) continue;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy));
        total += w;
        if (sample.passed) passed += w;
      }
      share[j * cells + i] = total > 0 ? passed / total : Number.NaN;
      weight[j * cells + i] = total;
    }
  }
  return { xs, ys, share, weight };
}

/** A line in the values of both axes. */
export type ContourLine = Array<[number, number]>;

/**
 * The lines where a field's share crosses `level`, by marching squares. Squares with a
 * corner resting on fewer than `minWeight` runs are left out, so no line is drawn where
 * there are too few runs to say. A line that closes on itself ends where it began.
 */
export function contour(field: PassField, level: number, minWeight = 0): ContourLine[] {
  const { xs, ys, share, weight } = field;
  const nx = xs.length;
  const ny = ys.length;
  // Each grid edge has a number: those along x first, then those along y.
  const along = (i: number, j: number) => j * (nx - 1) + i;
  const up = (i: number, j: number) => (nx - 1) * ny + j * nx + i;
  const at = (i: number, j: number) => share[j * nx + i];
  const points = new Map<number, [number, number]>();
  const crossing = (edge: number, i0: number, j0: number, i1: number, j1: number) => {
    if (!points.has(edge)) {
      const v0 = at(i0, j0);
      const v1 = at(i1, j1);
      const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
      points.set(edge, [xs[i0] + t * (xs[i1] - xs[i0]), ys[j0] + t * (ys[j1] - ys[j0])]);
    }
    return edge;
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // Corners counterclockwise from the low one: a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1).
      const corners = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const values = corners.map(([ci, cj]) => at(ci, cj));
      if (values.some((v) => Number.isNaN(v))) continue;
      if (corners.some(([ci, cj]) => weight[cj * nx + ci] < minWeight)) continue;
      const [a, b, c, d] = values.map((v) => v >= level);
      const bottom = () => crossing(along(i, j), i, j, i + 1, j);
      const right = () => crossing(up(i + 1, j), i + 1, j, i + 1, j + 1);
      const top = () => crossing(along(i, j + 1), i, j + 1, i + 1, j + 1);
      const left = () => crossing(up(i, j), i, j, i, j + 1);
      const sides: number[] = [];
      if (a !== b) sides.push(bottom());
      if (b !== c) sides.push(right());
      if (c !== d) sides.push(top());
      if (d !== a) sides.push(left());
      if (sides.length === 2) {
        link(sides[0], sides[1]);
      } else if (sides.length === 4) {
        // A saddle: the middle of the square decides which corners are cut off.
        const middle = values.reduce((sum, v) => sum + v, 0) / 4 >= level;
        if (middle === a) {
          link(bottom(), right());
          link(top(), left());
        } else {
          link(left(), bottom());
          link(right(), top());
        }
      }
    }
  }

  // Join the pieces into lines: first those with loose ends, then the closed ones.
  const lines: ContourLine[] = [];
  const walk = (start: number) => {
    const line: ContourLine = [points.get(start) as [number, number]];
    let previous = -1;
    let current = start;
    for (;;) {
      const next = (links.get(current) ?? []).find((edge) => edge !== previous);
      if (next === undefined) break;
      const rest = links.get(current) as number[];
      rest.splice(rest.indexOf(next), 1);
      const back = links.get(next) as number[];
      back.splice(back.indexOf(current), 1);
      line.push(points.get(next) as [number, number]);
      previous = current;
      current = next;
      if (current === start) break;
    }
    if (line.length > 1) lines.push(line);
  };
  for (const [edge, ends] of links) if (ends.length === 1) walk(edge);
  for (const [edge, ends] of links) if (ends.length > 0) walk(edge);
  return lines;
}

/** About how many runs a share must rest on to be shaded at full strength. */
export const ENOUGH_RUNS = 8;

/**
 * How a place is shaded for its share passed: in the colour of passing or of failing, the
 * stronger the further the share is from even, and fainter where few runs lie near.
 */
export function shade(
  share: number,
  weight: number,
  strongest = 0.4,
): { passed: boolean; opacity: number } {
  if (Number.isNaN(share)) return { passed: false, opacity: 0 };
  const sure = Math.min(1, weight / ENOUGH_RUNS);
  return { passed: share >= 0.5, opacity: strongest * Math.abs(2 * share - 1) * sure };
}
