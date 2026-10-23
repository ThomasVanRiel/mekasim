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

/**
 * How a frame in space is turned at every sample: its three axes in the world, and
 * how fast it turns, as vectors in the world. Three numbers a sample for each rate,
 * nine for the axes (x, then y, then z).
 */
export interface SpaceTurning {
  axes: Float64Array;
  w: Float64Array;
  alpha: Float64Array;
  beta?: Float64Array;
}

/** A frame that turns about the sheet's z axis, as a frame in space. */
export function sheetTurning(turning: Turning | undefined, n: number): SpaceTurning {
  const out: SpaceTurning = {
    axes: new Float64Array(9 * n),
    w: new Float64Array(3 * n),
    alpha: new Float64Array(3 * n),
    beta: !turning || turning.beta ? new Float64Array(3 * n) : undefined,
  };
  for (let k = 0; k < n; k++) {
    const c = Math.cos(turning?.angle[k] ?? 0);
    const s = Math.sin(turning?.angle[k] ?? 0);
    out.axes.set([c, s, 0, -s, c, 0, 0, 0, 1], 9 * k);
    out.w[3 * k + 2] = turning?.w[k] ?? 0;
    out.alpha[3 * k + 2] = turning?.alpha[k] ?? 0;
    if (out.beta) out.beta[3 * k + 2] = turning?.beta?.[k] ?? 0;
  }
  return out;
}

type V = [number, number, number];

function crossOf(a: V, b: V): V {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** a - b - c - ..., for vectors. */
function less(a: V, ...rest: V[]): V {
  const out: V = [...a];
  for (const b of rest) for (let i = 0; i < 3; i++) out[i] = (out[i] as number) - b[i];
  return out;
}

function scale(a: V, by: number): V {
  return [a[0] * by, a[1] * by, a[2] * by];
}

/**
 * The motion of a point in the coordinates of a frame that may turn any way in
 * space, as `seenFrom` gives it for a frame on the sheet. A vector `u` of the world
 * seen in the frame changes as `u' - w × u`, which taken again and again gives each
 * rate.
 */
export function seenFromSpace(point: Path, origin: Path | undefined, turning: SpaceTurning): Path {
  const n = point.x.length;
  const has = (path: Path): boolean => Boolean(path.jx && path.jy);
  const jerk = has(point) && (!origin || has(origin)) && turning.beta !== undefined;
  const make = (): Float64Array => new Float64Array(n);
  const seen: Path = {
    x: make(),
    y: make(),
    z: make(),
    vx: make(),
    vy: make(),
    vz: make(),
    ax: make(),
    ay: make(),
    az: make(),
    jx: jerk ? make() : undefined,
    jy: jerk ? make() : undefined,
    jz: jerk ? make() : undefined,
  };
  const vec = (path: Path, xs: "x" | "vx" | "ax" | "jx", k: number): V => {
    const ys = xs.replace("x", "y") as "y" | "vy" | "ay" | "jy";
    const zs = xs.replace("x", "z") as "z" | "vz" | "az" | "jz";
    return [path[xs]?.[k] ?? 0, path[ys]?.[k] ?? 0, path[zs]?.[k] ?? 0];
  };
  const from = (xs: "x" | "vx" | "ax" | "jx", k: number): V =>
    less(vec(point, xs, k), origin ? vec(origin, xs, k) : [0, 0, 0]);
  const at = (of: Float64Array, k: number): V => [
    of[3 * k] as number,
    of[3 * k + 1] as number,
    of[3 * k + 2] as number,
  ];
  for (let k = 0; k < n; k++) {
    const axes = turning.axes.subarray(9 * k, 9 * k + 9);
    /** Put a vector of the world into the frame, as the k-th sample of three series. */
    const put = (u: V, xs: Float64Array, ys: Float64Array, zs: Float64Array): void => {
      for (const [i, into] of [xs, ys, zs].entries())
        into[k] =
          u[0] * (axes[3 * i] as number) +
          u[1] * (axes[3 * i + 1] as number) +
          u[2] * (axes[3 * i + 2] as number);
    };
    const w = at(turning.w, k);
    const alpha = at(turning.alpha, k);
    const d = from("x", k);
    const dv = from("vx", k);
    const da = from("ax", k);
    // e1 is the velocity seen in the frame, e2 the acceleration, both still in the
    // world's axes; d1 is how fast e1 changes in the world.
    const e1 = less(dv, crossOf(w, d));
    const d1 = less(da, crossOf(alpha, d), crossOf(w, dv));
    const e2 = less(d1, crossOf(w, e1));
    put(d, seen.x, seen.y, seen.z as Float64Array);
    put(e1, seen.vx, seen.vy, seen.vz as Float64Array);
    put(e2, seen.ax, seen.ay, seen.az as Float64Array);
    if (jerk && turning.beta && seen.jx && seen.jy && seen.jz) {
      const beta = at(turning.beta, k);
      const d2 = less(
        from("jx", k),
        crossOf(beta, d),
        scale(crossOf(alpha, dv), 2),
        crossOf(w, da),
        crossOf(alpha, e1),
        crossOf(w, d1),
      );
      put(less(d2, crossOf(w, e2)), seen.jx, seen.jy, seen.jz);
    }
  }
  return seen;
}
