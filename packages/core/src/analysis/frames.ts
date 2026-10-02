import type { PointJerk, PointMotion } from "./measures.ts";

/**
 * Motion as seen from a frame: a coordinate system with its origin on a point and
 * its x axis turned to some angle, either of which may move with the mechanism.
 * What is seen is relative: a point of a body, seen from a frame on that body,
 * stands still.
 */

/** The motion of a point, with its jerk where that has been worked out. */
export type Path = PointMotion & Partial<PointJerk>;

/** The angle of a frame's x axis at every sample, and the rates at which it turns. */
export interface Turning {
  angle: Float64Array;
  w: Float64Array;
  alpha: Float64Array;
  /** The rate of `alpha`; needed only for jerk. */
  beta?: Float64Array;
}

type Complex = [re: number, im: number];

function mul(a: Complex, b: Complex): Complex {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function div(a: Complex, b: Complex): Complex {
  const size = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / size, (a[1] * b[0] - a[0] * b[1]) / size];
}

/**
 * The turning of the line from one point to another, turned a further `offset`.
 * Undefined when the points coincide at some sample, since the line then has no
 * direction.
 */
export function lineTurning(from: Path, to: Path, offset: number): Turning | undefined {
  const n = from.x.length;
  const jerk = from.jx && from.jy && to.jx && to.jy;
  const turning: Turning = {
    angle: new Float64Array(n),
    w: new Float64Array(n),
    alpha: new Float64Array(n),
    beta: jerk ? new Float64Array(n) : undefined,
  };
  for (let k = 0; k < n; k++) {
    // The line as a complex number e; the imaginary part of e'/e is how fast it turns.
    const e: Complex = [to.x[k] - from.x[k], to.y[k] - from.y[k]];
    if (Math.hypot(e[0], e[1]) < 1e-12) return undefined;
    const rate = div([to.vx[k] - from.vx[k], to.vy[k] - from.vy[k]], e);
    const second = div([to.ax[k] - from.ax[k], to.ay[k] - from.ay[k]], e);
    const rate2 = mul(rate, rate);
    const change: Complex = [second[0] - rate2[0], second[1] - rate2[1]];
    turning.angle[k] = Math.atan2(e[1], e[0]) + offset;
    turning.w[k] = rate[1];
    turning.alpha[k] = change[1];
    if (turning.beta && to.jx && to.jy && from.jx && from.jy) {
      const third = div([to.jx[k] - from.jx[k], to.jy[k] - from.jy[k]], e);
      turning.beta[k] = third[1] - mul(second, rate)[1] - 2 * mul(rate, change)[1];
    }
  }
  return turning;
}

/**
 * The motion of a point in the coordinates of a frame: its position from the
 * frame's origin along the frame's axes, and the rates at which those coordinates
 * change. Without an origin positions are counted from the origin of the sheet;
 * without a turning the axes are those of the sheet. The jerk is given when every
 * part of the frame and the point come with theirs.
 */
export function seenFrom(point: Path, origin?: Path, turning?: Turning): Path {
  const n = point.x.length;
  const jerk =
    point.jx && point.jy && (!origin || (origin.jx && origin.jy)) && (!turning || turning.beta);
  const seen: Path = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    ax: new Float64Array(n),
    ay: new Float64Array(n),
    jx: jerk ? new Float64Array(n) : undefined,
    jy: jerk ? new Float64Array(n) : undefined,
  };
  for (let k = 0; k < n; k++) {
    // The point from the origin, along the axes of the sheet.
    const dx = point.x[k] - (origin?.x[k] ?? 0);
    const dy = point.y[k] - (origin?.y[k] ?? 0);
    const vx = point.vx[k] - (origin?.vx[k] ?? 0);
    const vy = point.vy[k] - (origin?.vy[k] ?? 0);
    const ax = point.ax[k] - (origin?.ax[k] ?? 0);
    const ay = point.ay[k] - (origin?.ay[k] ?? 0);
    const w = turning?.w[k] ?? 0;
    const alpha = turning?.alpha[k] ?? 0;
    const c = Math.cos(turning?.angle[k] ?? 0);
    const s = Math.sin(turning?.angle[k] ?? 0);
    /** Turn a vector of the sheet into the frame. */
    const put = (xs: Float64Array, ys: Float64Array, x: number, y: number): void => {
      xs[k] = x * c + y * s;
      ys[k] = -x * s + y * c;
    };

    // Each rate takes off what the turning of the frame itself adds.
    put(seen.x, seen.y, dx, dy);
    put(seen.vx, seen.vy, vx + w * dy, vy - w * dx);
    put(
      seen.ax,
      seen.ay,
      ax + 2 * w * vy + alpha * dy - w * w * dx,
      ay - 2 * w * vx - alpha * dx - w * w * dy,
    );
    if (seen.jx && seen.jy && point.jx && point.jy) {
      const jx = point.jx[k] - (origin?.jx?.[k] ?? 0);
      const jy = point.jy[k] - (origin?.jy?.[k] ?? 0);
      const beta = turning?.beta?.[k] ?? 0;
      put(
        seen.jx,
        seen.jy,
        jx +
          3 * w * ay +
          3 * alpha * vy -
          3 * w * w * vx +
          (beta - w ** 3) * dy -
          3 * w * alpha * dx,
        jy -
          3 * w * ax -
          3 * alpha * vx -
          3 * w * w * vy -
          (beta - w ** 3) * dx -
          3 * w * alpha * dy,
      );
    }
  }
  return seen;
}
