import type { Mat } from "./linalg.ts";

/**
 * Planar constraint formulation. Each moving body `b` owns three coordinates
 * `q[3b..3b+2] = (x, y, phi)`. The fixed body has index -1 and no coordinates.
 */
export const GROUND_INDEX = -1;

/** A point fixed in a body's frame, in metres. */
export interface BodyPoint {
  body: number;
  u: number;
  v: number;
}

export interface Constraint {
  /** Id of the joint or driver this came from, for diagnostics. */
  readonly source: string;
  readonly driver: boolean;
  /** Number of equations. */
  readonly size: number;
  /** Write the constraint error `Phi(q, t)` into `out[row..]`. */
  residual(q: Float64Array, t: number, out: Float64Array, row: number): void;
  /** Add `dPhi/dq` into rows `row..` of `jac`. */
  jacobian(q: Float64Array, jac: Mat, row: number): void;
  /** Right-hand side of `Phi_q qd = nu`. */
  velocityRhs(out: Float64Array, row: number): void;
  /** Right-hand side of `Phi_q qdd = gamma`. */
  accelerationRhs(q: Float64Array, qd: Float64Array, out: Float64Array, row: number): void;
}

interface Placed {
  /** World position. */
  x: number;
  y: number;
  /** Offset from the body origin, rotated into the world. */
  bx: number;
  by: number;
}

function place(q: Float64Array, p: BodyPoint): Placed {
  if (p.body < 0) return { x: p.u, y: p.v, bx: p.u, by: p.v };
  const i = 3 * p.body;
  const c = Math.cos(q[i + 2]);
  const s = Math.sin(q[i + 2]);
  const bx = p.u * c - p.v * s;
  const by = p.u * s + p.v * c;
  return { x: q[i] + bx, y: q[i + 1] + by, bx, by };
}

function rate(qd: Float64Array, body: number, k: 0 | 1 | 2): number {
  return body < 0 ? 0 : qd[3 * body + k];
}

function add(jac: Mat, row: number, body: number, dx: number, dy: number, dphi: number): void {
  if (body < 0) return;
  const at = row * jac.cols + 3 * body;
  jac.data[at] = jac.data[at] + dx;
  jac.data[at + 1] = jac.data[at + 1] + dy;
  jac.data[at + 2] = jac.data[at + 2] + dphi;
}

/** Two points share one position: a pin. */
export function coincident(source: string, a: BodyPoint, b: BodyPoint): Constraint {
  return {
    source,
    driver: false,
    size: 2,
    residual(q, _t, out, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      out[row] = pa.x - pb.x;
      out[row + 1] = pa.y - pb.y;
    },
    jacobian(q, jac, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      add(jac, row, a.body, 1, 0, -pa.by);
      add(jac, row + 1, a.body, 0, 1, pa.bx);
      add(jac, row, b.body, -1, 0, pb.by);
      add(jac, row + 1, b.body, 0, -1, -pb.bx);
    },
    velocityRhs(out, row) {
      out[row] = 0;
      out[row + 1] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      const wa = rate(qd, a.body, 2) ** 2;
      const wb = rate(qd, b.body, 2) ** 2;
      out[row] = wa * pa.bx - wb * pb.bx;
      out[row + 1] = wa * pa.by - wb * pb.by;
    },
  };
}

/**
 * A point stays on a line fixed in another body. `origin` is a point on the line and
 * `(nu, nv)` its unit normal, both in the frame of the line's body.
 */
export function pointOnLine(
  source: string,
  origin: BodyPoint,
  nu: number,
  nv: number,
  pin: BodyPoint,
): Constraint {
  const line = origin.body;

  function normal(q: Float64Array): [number, number] {
    if (line < 0) return [nu, nv];
    const phi = q[3 * line + 2];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return [nu * c - nv * s, nu * s + nv * c];
  }

  return {
    source,
    driver: false,
    size: 1,
    residual(q, _t, out, row) {
      const [nx, ny] = normal(q);
      const po = place(q, origin);
      const pp = place(q, pin);
      out[row] = nx * (pp.x - po.x) + ny * (pp.y - po.y);
    },
    jacobian(q, jac, row) {
      const [nx, ny] = normal(q);
      const po = place(q, origin);
      const pp = place(q, pin);
      const wx = pp.x - po.x;
      const wy = pp.y - po.y;
      add(jac, row, pin.body, nx, ny, -nx * pp.by + ny * pp.bx);
      // The normal turns with the line's body: d(n)/d(phi) = (-ny, nx).
      add(jac, row, line, -nx, -ny, -ny * wx + nx * wy - (-nx * po.by + ny * po.bx));
    },
    velocityRhs(out, row) {
      out[row] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      const [nx, ny] = normal(q);
      const po = place(q, origin);
      const pp = place(q, pin);
      const wx = pp.x - po.x;
      const wy = pp.y - po.y;
      const wl = rate(qd, line, 2);
      const wp = rate(qd, pin.body, 2);
      // Velocity of the pin relative to the line's origin point.
      const vx = rate(qd, pin.body, 0) - wp * pp.by - (rate(qd, line, 0) - wl * po.by);
      const vy = rate(qd, pin.body, 1) + wp * pp.bx - (rate(qd, line, 1) + wl * po.bx);
      out[row] =
        wl * wl * (nx * wx + ny * wy) -
        2 * wl * (-ny * vx + nx * vy) +
        nx * (wp * wp * pp.bx - wl * wl * po.bx) +
        ny * (wp * wp * pp.by - wl * wl * po.by);
    },
  };
}

/**
 * The angle of body `b` relative to body `a` equals `angle + speed * t`.
 * With a speed this is a motor; without, a rotation lock.
 */
export function relativeAngle(
  source: string,
  a: number,
  b: number,
  angle: number,
  speed = 0,
  driver = false,
): Constraint {
  return {
    source,
    driver,
    size: 1,
    residual(q, t, out, row) {
      const pa = a < 0 ? 0 : q[3 * a + 2];
      const pb = b < 0 ? 0 : q[3 * b + 2];
      out[row] = pb - pa - (angle + speed * t);
    },
    jacobian(_q, jac, row) {
      add(jac, row, b, 0, 0, 1);
      add(jac, row, a, 0, 0, -1);
    },
    velocityRhs(out, row) {
      out[row] = speed;
    },
    accelerationRhs(_q, _qd, out, row) {
      out[row] = 0;
    },
  };
}
