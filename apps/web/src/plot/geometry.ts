/** Geometry for line charts: scales, tick positions, paths. No drawing here. */

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

const DECIMAL = [1, 2, 5, 10];
/** Steps that divide a turn evenly, for axes in degrees. */
const DEGREES = [1, 2, 5, 10, 15, 30, 45, 90, 180, 360];

function niceStep(raw: number, degrees: boolean): number {
  if (degrees && raw > 0.5 && raw <= 360) return DEGREES.find((step) => step >= raw) ?? 360;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  return (DECIMAL.find((base) => base >= lead - 1e-9) ?? 10) * power;
}

function ticksBetween(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  // Multiplying an integer avoids the drift of repeated addition.
  for (let k = first; k <= last; k++) ticks.push(Number((k * step).toPrecision(12)));
  return ticks;
}

/** A scale for values: widened to round numbers so the data does not touch the frame. */
export function valueScale(low: number, high: number, target = 4): Scale {
  let min = low;
  let max = high;
  if (!(max > min)) {
    // A constant: give it room on both sides.
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / target, false);
  min = Math.floor(min / step + 1e-9) * step;
  max = Math.ceil(max / step - 1e-9) * step;
  return { min, max, ticks: ticksBetween(min, max, step) };
}

/** A scale for the horizontal axis: exactly the extent of the data, with round ticks inside. */
export function extentScale(min: number, max: number, target = 8, degrees = false): Scale {
  if (!(max > min)) return { min, max: min + 1, ticks: [min] };
  return { min, max, ticks: ticksBetween(min, max, niceStep((max - min) / target, degrees)) };
}

/** A function from a value on a scale to a pixel position. */
export function mapper(scale: Scale, from: number, to: number): (value: number) => number {
  const span = scale.max - scale.min;
  return (value) => from + ((value - scale.min) / span) * (to - from);
}

/** An SVG path through the points, to a tenth of a pixel. */
export function linePath(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  mapX: (value: number) => number,
  mapY: (value: number) => number,
): string {
  const count = Math.min(xs.length, ys.length);
  let path = "";
  for (let k = 0; k < count; k++) {
    const y = ys[k] as number;
    if (!Number.isFinite(y)) continue;
    path += `${path ? "L" : "M"}${mapX(xs[k] as number).toFixed(1)} ${mapY(y).toFixed(1)}`;
  }
  return path;
}

/**
 * Move positions apart so that none are closer than `gap`, keeping their order and
 * staying within `[low, high]` where that is possible. For labels beside line ends.
 */
export function spread(positions: number[], gap: number, low: number, high: number): number[] {
  const order = positions
    .map((_, i) => i)
    .sort((a, b) => (positions[a] as number) - (positions[b] as number));
  const placed = order.map((i) => positions[i] as number);
  for (let k = 0; k < placed.length; k++) {
    const floor = k === 0 ? low : (placed[k - 1] as number) + gap;
    placed[k] = Math.max(placed[k] as number, floor);
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    const ceiling = k === placed.length - 1 ? high : (placed[k + 1] as number) - gap;
    placed[k] = Math.min(placed[k] as number, ceiling);
  }
  const result = new Array<number>(positions.length);
  order.forEach((i, k) => {
    result[i] = placed[k] as number;
  });
  return result;
}

/** Index of the sample whose x is nearest a value. `xs` must be rising or falling throughout. */
export function nearestIndex(xs: ArrayLike<number>, value: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < xs.length; k++) {
    const d = Math.abs((xs[k] as number) - value);
    if (d < distance) {
      distance = d;
      best = k;
    }
  }
  return best;
}

/** A number as short as it can be shown without losing what matters at chart size. */
export function formatNumber(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Number(value.toPrecision(digits));
  return (rounded === 0 ? 0 : rounded).toString();
}
