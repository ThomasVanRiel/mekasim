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

/** Two points stay a fixed distance apart: a link without a body. */
export function distance(source: string, a: BodyPoint, b: BodyPoint, length: number): Constraint {
  return {
    source,
    driver: false,
    size: 1,
    residual(q, _t, out, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      out[row] = Math.hypot(pa.x - pb.x, pa.y - pb.y) - length;
    },
    jacobian(q, jac, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      const ex = (pa.x - pb.x) / d;
      const ey = (pa.y - pb.y) / d;
      add(jac, row, a.body, ex, ey, -ex * pa.by + ey * pa.bx);
      add(jac, row, b.body, -ex, -ey, ex * pb.by - ey * pb.bx);
    },
    velocityRhs(out, row) {
      out[row] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      const pa = place(q, a);
      const pb = place(q, b);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      const ex = (pa.x - pb.x) / d;
      const ey = (pa.y - pb.y) / d;
      const wa = rate(qd, a.body, 2);
      const wb = rate(qd, b.body, 2);
      // Rate of change of the vector between the points.
      const vx = rate(qd, a.body, 0) - wa * pa.by - (rate(qd, b.body, 0) - wb * pb.by);
      const vy = rate(qd, a.body, 1) + wa * pa.bx - (rate(qd, b.body, 1) + wb * pb.bx);
      const along = ex * vx + ey * vy;
      out[row] =
        -(vx * vx + vy * vy - along * along) / d +
        ex * (wa * wa * pa.bx - wb * wb * pb.bx) +
        ey * (wa * wa * pa.by - wb * wb * pb.by);
    },
  };
}

/**
 * The rotations of two bodies are tied, as by meshing gears or a belt:
 * `ka * angle(a) + kb * angle(b) = constant`, with both angles taken relative to
 * the body that carries the two axes.
 */
export function angleCoupling(
  source: string,
  a: number,
  b: number,
  carrier: number,
  ka: number,
  kb: number,
  constant: number,
): Constraint {
  const angle = (q: Float64Array, body: number): number => (body < 0 ? 0 : q[3 * body + 2]);
  return {
    source,
    driver: false,
    size: 1,
    residual(q, _t, out, row) {
      const c = angle(q, carrier);
      out[row] = ka * (angle(q, a) - c) + kb * (angle(q, b) - c) - constant;
    },
    jacobian(_q, jac, row) {
      add(jac, row, a, 0, 0, ka);
      add(jac, row, b, 0, 0, kb);
      add(jac, row, carrier, 0, 0, -ka - kb);
    },
    velocityRhs(out, row) {
      out[row] = 0;
    },
    accelerationRhs(_q, _qd, out, row) {
      out[row] = 0;
    },
  };
}

/** The pitch curve of a cam: distance from its centre as a function of the angle around it. */
export interface CamProfile {
  radius(theta: number): number;
  /** First and second derivative of the radius with respect to the angle. */
  slope(theta: number): number;
  curvature(theta: number): number;
}

/**
 * A follower point rides on a cam: seen from the cam, it stays on the pitch curve.
 * `centre` is the cam's centre on the cam body. Contact is always kept; a follower
 * that would lift off in reality does not here.
 */
export function camContact(
  source: string,
  centre: BodyPoint,
  follower: BodyPoint,
  profile: CamProfile,
): Constraint {
  const cam = centre.body;

  /** The follower seen from the cam: position `(px, py)` in the cam's frame, and what is needed around it. */
  function view(q: Float64Array) {
    const po = place(q, centre);
    const pf = place(q, follower);
    const phi = cam < 0 ? 0 : q[3 * cam + 2];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const wx = pf.x - po.x;
    const wy = pf.y - po.y;
    const px = wx * c + wy * s;
    const py = -wx * s + wy * c;
    const rho = Math.hypot(px, py) || 1e-12;
    const theta = Math.atan2(py, px);
    const slope = profile.slope(theta);
    // Gradient of the constraint with respect to the follower's position in the cam frame.
    const gx = px / rho + (slope * py) / (rho * rho);
    const gy = py / rho - (slope * px) / (rho * rho);
    return { po, pf, c, s, px, py, rho, theta, slope, gx, gy };
  }

  return {
    source,
    driver: false,
    size: 1,
    residual(q, _t, out, row) {
      const { rho, theta } = view(q);
      out[row] = rho - profile.radius(theta);
    },
    jacobian(q, jac, row) {
      const { po, pf, c, s, slope, gx, gy } = view(q);
      // The gradient turned into the world.
      const wx = gx * c - gy * s;
      const wy = gx * s + gy * c;
      add(jac, row, follower.body, wx, wy, -wx * pf.by + wy * pf.bx);
      // Turning the cam moves its centre point, and shifts where on the profile the follower sits.
      add(jac, row, cam, -wx, -wy, wx * po.by - wy * po.bx + slope);
    },
    velocityRhs(out, row) {
      out[row] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      const { po, pf, c, s, px, py, rho, theta, slope, gx, gy } = view(q);
      const wc = rate(qd, cam, 2);
      const wf = rate(qd, follower.body, 2);
      // Velocity of the follower relative to the cam centre, in the world and then in the cam frame.
      const vx = rate(qd, follower.body, 0) - wf * pf.by - (rate(qd, cam, 0) - wc * po.by);
      const vy = rate(qd, follower.body, 1) + wf * pf.bx - (rate(qd, cam, 1) + wc * po.bx);
      const rx = vx * c + vy * s;
      const ry = -vx * s + vy * c;
      const dx = rx + wc * py;
      const dy = ry - wc * px;
      // The part of the follower's acceleration in the cam frame that comes from velocities alone.
      const ax = -wf * wf * pf.bx + wc * wc * po.bx;
      const ay = -wf * wf * pf.by + wc * wc * po.by;
      const kx = ax * c + ay * s + wc * ry + wc * dy;
      const ky = -ax * s + ay * c - wc * rx - wc * dx;

      // Second derivatives of the constraint with respect to the cam-frame position.
      const r2 = rho * rho;
      const r4 = r2 * r2;
      const tx = -py / r2;
      const ty = px / r2;
      const curve = profile.curvature(theta);
      const hxx = (1 - (px * px) / r2) / rho - curve * tx * tx - (slope * 2 * px * py) / r4;
      const hxy = (-px * py) / r2 / rho - curve * tx * ty - (slope * (py * py - px * px)) / r4;
      const hyy = (1 - (py * py) / r2) / rho - curve * ty * ty + (slope * 2 * px * py) / r4;

      out[row] = -(hxx * dx * dx + 2 * hxy * dx * dy + hyy * dy * dy) - (gx * kx + gy * ky);
    },
  };
}
