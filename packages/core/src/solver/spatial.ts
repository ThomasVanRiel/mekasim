import type { Constraint } from "./constraints.ts";
import type { Mat } from "./linalg.ts";

/**
 * Spatial constraint formulation, after Haug and Nikravesh. A body in space owns seven
 * coordinates starting at its block's offset `at`: its position `r = (x, y, z)` and
 * then its Euler parameters `p = (e0, e1, e2, e3)`, a quaternion kept of unit length
 * by `unitQuaternion`. The fixed body has `at = -1` and no coordinates.
 */
export const SPATIAL_SIZE = 7;

export type Vec3 = [number, number, number];

/** A point fixed in a body's frame, in metres. */
export interface SpatialPoint {
  /** Offset of the body's block in `q`; -1 for the fixed body. */
  at: number;
  s: Vec3;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function unit(a: Vec3): Vec3 {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
}

/** Two unit vectors that make a right-handed frame with the unit vector `h`. */
export function perpendiculars(h: Vec3): [Vec3, Vec3] {
  // Start from the world axis furthest from h, so the cross product is well away from zero.
  const ax = Math.abs(h[0]);
  const ay = Math.abs(h[1]);
  const az = Math.abs(h[2]);
  const away: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const f = unit(cross(away, h));
  return [f, cross(h, f)];
}

const NO_TURN = [1, 0, 0, 0] as const;

/** The Euler parameters of the block at `at` in `v`, or of no turning for the fixed body. */
function params(v: Float64Array, at: number): ArrayLike<number> {
  return at < 0 ? NO_TURN : v.subarray(at + 3, at + 7);
}

/** The Euler parameters for turning by `angle` about the unit vector `axis`. */
export function quaternion(axis: Vec3, angle: number): [number, number, number, number] {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), s * axis[0], s * axis[1], s * axis[2]];
}

/**
 * `A(p) s`: the vector `s` of a body's frame turned into the world. Written as
 * `(e0² - e·e) s + 2 e (e·s) + 2 e0 (e × s)`, a form quadratic in `p`, so that its
 * derivative is `B(p, s)` exactly and `B(pd, s) pd` is all its second derivative adds.
 */
export function rotate(p: ArrayLike<number>, s: Vec3): Vec3 {
  const e0 = p[0];
  const e: Vec3 = [p[1], p[2], p[3]];
  const k = e0 * e0 - dot(e, e);
  const es = 2 * dot(e, s);
  const c = cross(e, s);
  return [
    k * s[0] + es * e[0] + 2 * e0 * c[0],
    k * s[1] + es * e[1] + 2 * e0 * c[1],
    k * s[2] + es * e[2] + 2 * e0 * c[2],
  ];
}

/** `A(p)^T a`: a world vector seen in a body's frame, for a unit `p`. */
export function unrotate(p: ArrayLike<number>, a: Vec3): Vec3 {
  return rotate([p[0], -p[1], -p[2], -p[3]], a);
}

/**
 * `B(p, s) = d(A(p) s)/dp`, a 3 × 4 matrix written row by row: the first column is
 * `2 (e0 s + e × s)`, the others `2 (-e_k s + (e·s) u_k + s_k e + e0 u_k × s)`.
 */
function bMatrix(p: ArrayLike<number>, s: Vec3): Float64Array {
  const e0 = p[0];
  const e: Vec3 = [p[1], p[2], p[3]];
  const es = dot(e, s);
  const c = cross(e, s);
  const out = new Float64Array(12);
  for (let i = 0; i < 3; i++) out[i * 4] = 2 * (e0 * s[i] + c[i]);
  for (let k = 0; k < 3; k++) {
    const uk: Vec3 = [0, 0, 0];
    uk[k] = 1;
    const turned = cross(uk, s);
    for (let i = 0; i < 3; i++) {
      out[i * 4 + k + 1] = 2 * (-e[k] * s[i] + es * uk[i] + s[k] * e[i] + e0 * turned[i]);
    }
  }
  return out;
}

/** `B(p, s) x` for four numbers `x`. */
function times(b: Float64Array, x: ArrayLike<number>): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = b[i * 4] * x[0] + b[i * 4 + 1] * x[1] + b[i * 4 + 2] * x[2] + b[i * 4 + 3] * x[3];
  }
  return out;
}

/** Where a point of a body is in the world. */
export function placePoint(q: Float64Array, point: SpatialPoint): Vec3 {
  if (point.at < 0) return [...point.s];
  const turned = rotate(params(q, point.at), point.s);
  return [q[point.at] + turned[0], q[point.at + 1] + turned[1], q[point.at + 2] + turned[2]];
}

/** Where a point is, how fast it goes, and the part of its acceleration that comes from velocities alone. */
interface PointState {
  x: Vec3;
  v: Vec3;
  quad: Vec3;
}

/** The same for a direction fixed in a body. */
interface VectorState {
  a: Vec3;
  v: Vec3;
  quad: Vec3;
}

function pointState(q: Float64Array, qd: Float64Array, point: SpatialPoint): PointState {
  if (point.at < 0) return { x: [...point.s], v: [0, 0, 0], quad: [0, 0, 0] };
  const pd = params(qd, point.at);
  const turned = times(bMatrix(params(q, point.at), point.s), pd);
  const quad = times(bMatrix(pd, point.s), pd);
  const at = point.at;
  return {
    x: placePoint(q, point),
    v: [qd[at] + turned[0], qd[at + 1] + turned[1], qd[at + 2] + turned[2]],
    quad,
  };
}

function vectorState(q: Float64Array, qd: Float64Array, at: number, a: Vec3): VectorState {
  if (at < 0) return { a: [...a], v: [0, 0, 0], quad: [0, 0, 0] };
  const pd = params(qd, at);
  return {
    a: rotate(params(q, at), a),
    v: times(bMatrix(params(q, at), a), pd),
    quad: times(bMatrix(pd, a), pd),
  };
}

/** How fast a point of the body at `at` moves when the coordinates change at the rates `qd`. */
export function pointRate(q: Float64Array, qd: Float64Array, at: number, s: Vec3): Vec3 {
  return pointState(q, qd, { at, s }).v;
}

/**
 * Add `g · d(point)/dq` into row `row` of `jac`, for a gradient `g` taken with respect
 * to the point's world position.
 */
function addPoint(jac: Mat, row: number, point: SpatialPoint, g: Vec3, q: Float64Array): void {
  if (point.at < 0) return;
  addTranslation(jac, row, point.at, g);
  addTurning(jac, row, point.at, bMatrix(params(q, point.at), point.s), g);
}

function addTranslation(jac: Mat, row: number, at: number, g: Vec3): void {
  const base = row * jac.cols + at;
  for (let i = 0; i < 3; i++) jac.data[base + i] = jac.data[base + i] + g[i];
}

/** Add `g^T B` into the columns of a body's Euler parameters. */
function addTurning(jac: Mat, row: number, at: number, b: Float64Array, g: Vec3): void {
  const base = row * jac.cols + at + 3;
  for (let k = 0; k < 4; k++) {
    jac.data[base + k] = jac.data[base + k] + g[0] * b[k] + g[1] * b[4 + k] + g[2] * b[8 + k];
  }
}

/** Add `g · d(A a)/dq` for a direction `a` fixed in the body at `at`. */
function addVector(jac: Mat, row: number, at: number, a: Vec3, g: Vec3, q: Float64Array): void {
  if (at < 0) return;
  addTurning(jac, row, at, bMatrix(params(q, at), a), g);
}

/** One scalar equation of a spatial joint, with all it needs for the solver. */
interface Row {
  value(q: Float64Array): number;
  jacobian(q: Float64Array, jac: Mat, row: number): void;
  /** `gamma`: minus the part of the equation's second derivative that comes from velocities alone. */
  gamma(q: Float64Array, qd: Float64Array): number;
}

/** A direction fixed in a body: `a` in the frame of the body at `at`. */
interface BodyVector {
  at: number;
  a: Vec3;
}

/** The two directions stay square to each other: `a_i · a_j = 0`. */
function square(i: BodyVector, j: BodyVector): Row {
  return {
    value(q) {
      return dot(rotate(params(q, i.at), i.a), rotate(params(q, j.at), j.a));
    },
    jacobian(q, jac, row) {
      const ai = rotate(params(q, i.at), i.a);
      const aj = rotate(params(q, j.at), j.a);
      addVector(jac, row, i.at, i.a, aj, q);
      addVector(jac, row, j.at, j.a, ai, q);
    },
    gamma(q, qd) {
      const si = vectorState(q, qd, i.at, i.a);
      const sj = vectorState(q, qd, j.at, j.a);
      return -(dot(si.a, sj.quad) + dot(sj.a, si.quad) + 2 * dot(si.v, sj.v));
    },
  };
}

/**
 * The line from a point of one body to a point of another stays square to a direction
 * of the first: `a_i · (P_j - P_i) = 0`.
 */
function across(direction: BodyVector, from: SpatialPoint, to: SpatialPoint): Row {
  return {
    value(q) {
      const a = rotate(params(q, direction.at), direction.a);
      return dot(a, sub(placePoint(q, to), placePoint(q, from)));
    },
    jacobian(q, jac, row) {
      const a = rotate(params(q, direction.at), direction.a);
      const d = sub(placePoint(q, to), placePoint(q, from));
      addVector(jac, row, direction.at, direction.a, d, q);
      addPoint(jac, row, to, a, q);
      addPoint(jac, row, from, [-a[0], -a[1], -a[2]], q);
    },
    gamma(q, qd) {
      const a = vectorState(q, qd, direction.at, direction.a);
      const pi = pointState(q, qd, from);
      const pj = pointState(q, qd, to);
      const d = sub(pj.x, pi.x);
      const dv = sub(pj.v, pi.v);
      return -(dot(d, a.quad) + dot(a.a, sub(pj.quad, pi.quad)) + 2 * dot(a.v, dv));
    },
  };
}

/** One world coordinate of two points is the same. */
function together(a: SpatialPoint, b: SpatialPoint, k: 0 | 1 | 2): Row {
  const g: Vec3 = [0, 0, 0];
  g[k] = 1;
  const minus: Vec3 = [-g[0], -g[1], -g[2]];
  return {
    value(q) {
      return placePoint(q, a)[k] - placePoint(q, b)[k];
    },
    jacobian(q, jac, row) {
      addPoint(jac, row, a, g, q);
      addPoint(jac, row, b, minus, q);
    },
    gamma(q, qd) {
      return -(pointState(q, qd, a).quad[k] - pointState(q, qd, b).quad[k]);
    },
  };
}

/** A joint of the rows given, none of them driven, and none depending on time. */
function joint(source: string, rows: Row[]): Constraint {
  return {
    source,
    driver: false,
    size: rows.length,
    residual(q, _t, out, row) {
      rows.forEach((r, i) => {
        out[row + i] = r.value(q);
      });
    },
    jacobian(q, jac, row) {
      rows.forEach((r, i) => {
        r.jacobian(q, jac, row + i);
      });
    },
    velocityRhs(out, row) {
      for (let i = 0; i < rows.length; i++) out[row + i] = 0;
    },
    accelerationRhs(q, qd, out, row) {
      rows.forEach((r, i) => {
        out[row + i] = r.gamma(q, qd);
      });
    },
  };
}

/** Keeps the Euler parameters of the body at `at` of unit length: `p · p = 1`. */
export function unitQuaternion(source: string, at: number): Constraint {
  return joint(source, [
    {
      value(q) {
        const p = params(q, at);
        return p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + p[3] * p[3] - 1;
      },
      jacobian(q, jac, row) {
        const p = params(q, at);
        const base = row * jac.cols + at + 3;
        for (let k = 0; k < 4; k++) jac.data[base + k] = jac.data[base + k] + 2 * p[k];
      },
      gamma(_q, qd) {
        const pd = params(qd, at);
        return -2 * (pd[0] * pd[0] + pd[1] * pd[1] + pd[2] * pd[2] + pd[3] * pd[3]);
      },
    },
  ]);
}

function pointRows(a: SpatialPoint, b: SpatialPoint): Row[] {
  return [together(a, b, 0), together(a, b, 1), together(a, b, 2)];
}

/** Rows that keep the direction `h` of body `j` along the direction whose square frame is `f, g` on body `i`. */
function parallelRows(i: number, f: Vec3, g: Vec3, j: number, h: Vec3): Row[] {
  return [square({ at: i, a: f }, { at: j, a: h }), square({ at: i, a: g }, { at: j, a: h })];
}

/** Two points share one position, and each body turns freely about it: a ball joint. */
export function spherical(source: string, a: SpatialPoint, b: SpatialPoint): Constraint {
  return joint(source, pointRows(a, b));
}

/**
 * A ball joint whose two bodies also keep the directions `ha` and `hb` square to
 * each other, as the two pins of a cross do: a universal joint. Each direction is a
 * unit vector in its own body's frame.
 */
export function universal(
  source: string,
  a: SpatialPoint,
  b: SpatialPoint,
  ha: Vec3,
  hb: Vec3,
): Constraint {
  return joint(source, [...pointRows(a, b), square({ at: a.at, a: ha }, { at: b.at, a: hb })]);
}

/** A ball joint whose bodies also keep the axes `ha` and `hb` in line: a hinge. */
export function revolute(
  source: string,
  a: SpatialPoint,
  b: SpatialPoint,
  ha: Vec3,
  hb: Vec3,
): Constraint {
  const [f, g] = perpendiculars(ha);
  return joint(source, [...pointRows(a, b), ...parallelRows(a.at, f, g, b.at, hb)]);
}

/**
 * The point `b` stays on the line through `a` along `ha`, and the axis `hb` of its body
 * along that line: it slides along it and turns about it.
 */
export function cylindrical(
  source: string,
  a: SpatialPoint,
  b: SpatialPoint,
  ha: Vec3,
  hb: Vec3,
): Constraint {
  return joint(source, cylinderRows(a, b, ha, hb));
}

function cylinderRows(a: SpatialPoint, b: SpatialPoint, ha: Vec3, hb: Vec3): Row[] {
  const [f, g] = perpendiculars(ha);
  return [
    ...parallelRows(a.at, f, g, b.at, hb),
    across({ at: a.at, a: f }, a, b),
    across({ at: a.at, a: g }, a, b),
  ];
}

/**
 * A cylindrical joint that may not turn: the direction `fb` of the second body keeps
 * square to `ga` of the first, where `fa` (square to `ha`) and `fb` (square to `hb`)
 * are the directions that lie together, and `ga = ha × fa`.
 */
export function prismatic(
  source: string,
  a: SpatialPoint,
  b: SpatialPoint,
  ha: Vec3,
  hb: Vec3,
  fa: Vec3,
  fb: Vec3,
): Constraint {
  return joint(source, [
    ...cylinderRows(a, b, ha, hb),
    square({ at: a.at, a: cross(ha, fa) }, { at: b.at, a: fb }),
  ]);
}

/** The point `b` stays on the plane through `a` square to the direction `n` of a's body. */
export function pointOnPlane(
  source: string,
  a: SpatialPoint,
  n: Vec3,
  b: SpatialPoint,
): Constraint {
  return joint(source, [across({ at: a.at, a: n }, a, b)]);
}

/** The point `b` stays on the line through `a` along the direction `h` of a's body. */
export function pointOnSpatialLine(
  source: string,
  a: SpatialPoint,
  h: Vec3,
  b: SpatialPoint,
): Constraint {
  const [f, g] = perpendiculars(h);
  return joint(source, [across({ at: a.at, a: f }, a, b), across({ at: a.at, a: g }, a, b)]);
}

/**
 * Turns the second body of a hinge about its axis: the angle from `fa` to `fb`, seen
 * about `ha`, equals `angle + speed * t`. `fa` is square to `ha` in the first body's
 * frame and `fb` square to the hinge axis in the second's; where they lie together
 * the angle is 0. The angle is read with `atan2`, so it holds at every turn.
 */
export function hingeAngle(
  source: string,
  a: number,
  b: number,
  ha: Vec3,
  fa: Vec3,
  fb: Vec3,
  angle: number,
  speed = 0,
  driver = false,
): Constraint {
  // The cosine and sine of the angle are c = fa · fb and s = ga · fb.
  const cos = square({ at: a, a: fa }, { at: b, a: fb });
  const sin = square({ at: a, a: cross(ha, fa) }, { at: b, a: fb });
  const rates = (q: Float64Array, qd: Float64Array, r: Row): number => {
    // The rate of a dot product: J qd, from a Jacobian row of its own.
    const jac: Mat = { rows: 1, cols: q.length, data: new Float64Array(q.length) };
    r.jacobian(q, jac, 0);
    let sum = 0;
    for (let k = 0; k < q.length; k++) sum += jac.data[k] * qd[k];
    return sum;
  };
  return {
    source,
    driver,
    size: 1,
    residual(q, t, out, row) {
      const turned = Math.atan2(sin.value(q), cos.value(q)) - (angle + speed * t);
      // The nearest whole turn: the error is what is left of it, between -pi and pi.
      out[row] = turned - 2 * Math.PI * Math.round(turned / (2 * Math.PI));
    },
    jacobian(q, jac, row) {
      const c = cos.value(q);
      const s = sin.value(q);
      const r2 = c * c + s * s;
      // d(atan2(s, c)) = (c ds - s dc) / (c² + s²).
      const ds: Mat = { rows: 1, cols: jac.cols, data: new Float64Array(jac.cols) };
      const dc: Mat = { rows: 1, cols: jac.cols, data: new Float64Array(jac.cols) };
      sin.jacobian(q, ds, 0);
      cos.jacobian(q, dc, 0);
      const base = row * jac.cols;
      for (let k = 0; k < jac.cols; k++) {
        jac.data[base + k] = jac.data[base + k] + (c * ds.data[k] - s * dc.data[k]) / r2;
      }
    },
    velocityRhs(out, row) {
      out[row] = speed;
    },
    accelerationRhs(q, qd, out, row) {
      const c = cos.value(q);
      const s = sin.value(q);
      const r2 = c * c + s * s;
      const cd = rates(q, qd, cos);
      const sd = rates(q, qd, sin);
      // The parts of c and s's second derivatives that come from velocities alone.
      const cq = -cos.gamma(q, qd);
      const sq = -sin.gamma(q, qd);
      const quad = (c * sq - s * cq) / r2 - (2 * (c * cd + s * sd) * (c * sd - s * cd)) / (r2 * r2);
      out[row] = -quad;
    },
  };
}
