import { describe, expect, it } from "vitest";
import { solveCycle } from "../src/analysis/cycle.ts";
import type { Constraint } from "../src/solver/constraints.ts";
import { mat, maxAbs } from "../src/solver/linalg.ts";
import { analyzeMobility } from "../src/solver/mobility.ts";
import { residual, type SolverModel, solvePosition } from "../src/solver/solve.ts";
import {
  cross,
  cylindrical,
  dot,
  hingeAngle,
  perpendiculars,
  placePoint,
  pointOnPlane,
  pointOnSpatialLine,
  prismatic,
  quaternion,
  revolute,
  rotate,
  SPATIAL_SIZE,
  spherical,
  unit,
  unitQuaternion,
  universal,
  unrotate,
  type Vec3,
} from "../src/solver/spatial.ts";

// A planar body first, then two bodies in space, in an arbitrary position and state of
// motion. The Euler parameters are not of unit length: the derivatives hold off it too.
const A = 3;
const B = 3 + SPATIAL_SIZE;
const q = Float64Array.of(
  0.1,
  -0.2,
  0.7,
  0.3,
  -0.1,
  0.2,
  0.8,
  0.3,
  -0.4,
  0.2,
  -0.2,
  0.4,
  0.1,
  0.5,
  -0.6,
  0.7,
  0.2,
);
const qd = Float64Array.of(
  0.5,
  0.2,
  -1.3,
  -0.4,
  0.9,
  0.3,
  0.6,
  -1.1,
  0.4,
  0.7,
  0.3,
  -0.6,
  0.8,
  -0.5,
  0.9,
  0.2,
  -0.7,
);
const n = q.length;

const h1 = unit([0.3, -0.5, 0.8]);
const h2 = unit([-0.6, 0.2, 0.4]);
const [f1] = perpendiculars(h1);
const [f2] = perpendiculars(h2);

const cases: [string, Constraint][] = [
  ["unit Euler parameters", unitQuaternion("b", A)],
  ["ball joint", spherical("j", { at: A, s: [0.1, -0.05, 0.2] }, { at: B, s: [-0.2, 0.1, 0.05] })],
  [
    "ball joint on ground",
    spherical("j", { at: -1, s: [0.3, 0.1, -0.2] }, { at: B, s: [0.1, 0, 0.2] }),
  ],
  [
    "universal joint",
    universal("j", { at: A, s: [0.1, -0.05, 0.2] }, { at: B, s: [-0.2, 0.1, 0.05] }, h1, h2),
  ],
  [
    "hinge",
    revolute("j", { at: A, s: [0.1, -0.05, 0.2] }, { at: B, s: [-0.2, 0.1, 0.05] }, h1, h2),
  ],
  [
    "hinge on ground",
    revolute("j", { at: -1, s: [0.3, 0.1, -0.2] }, { at: B, s: [0.1, 0, 0.2] }, h1, h2),
  ],
  [
    "cylindrical joint",
    cylindrical("j", { at: A, s: [0.1, -0.05, 0.2] }, { at: B, s: [-0.2, 0.1, 0.05] }, h1, h2),
  ],
  [
    "prismatic joint",
    prismatic(
      "j",
      { at: B, s: [0.1, -0.05, 0.2] },
      { at: A, s: [-0.2, 0.1, 0.05] },
      h2,
      h1,
      f2,
      f1,
    ),
  ],
  [
    "point on a plane",
    pointOnPlane("j", { at: A, s: [0.1, -0.05, 0.2] }, h1, { at: B, s: [-0.2, 0.1, 0.05] }),
  ],
  [
    "ground point on a moving plane",
    pointOnPlane("j", { at: B, s: [0.1, -0.05, 0.2] }, h2, { at: -1, s: [0.4, 0.3, 0.1] }),
  ],
  [
    "point on a line",
    pointOnSpatialLine("j", { at: -1, s: [0.1, -0.05, 0.2] }, h1, { at: A, s: [-0.2, 0.1, 0.05] }),
  ],
  ["hinge angle", hingeAngle("j", A, B, h1, f1, f2, 0.4)],
  ["motor on a hinge to ground", hingeAngle("d", -1, B, h1, f1, f2, 0.4, 3, true)],
];

function residualOf(c: Constraint, at: Float64Array, t = 0): Float64Array {
  const out = new Float64Array(c.size);
  c.residual(at, t, out, 0);
  return out;
}

function jacobianOf(c: Constraint, at: Float64Array): Float64Array {
  const jac = mat(c.size, n);
  c.jacobian(at, jac, 0);
  return jac.data;
}

function shifted(direction: Float64Array, h: number): Float64Array {
  return q.map((value, i) => value + h * direction[i]);
}

describe.each(cases)("%s", (_name, c) => {
  it("has a Jacobian matching finite differences of the residual", () => {
    const analytic = jacobianOf(c, q);
    const h = 1e-6;
    for (let j = 0; j < n; j++) {
      const step = new Float64Array(n);
      step[j] = 1;
      const plus = residualOf(c, shifted(step, h));
      const minus = residualOf(c, shifted(step, -h));
      for (let i = 0; i < c.size; i++) {
        expect(Math.abs(analytic[i * n + j] - (plus[i] - minus[i]) / (2 * h))).toBeLessThan(1e-7);
      }
    }
  });

  it("leaves the planar body's coordinates alone", () => {
    const analytic = jacobianOf(c, q);
    for (let i = 0; i < c.size; i++) {
      for (let j = 0; j < 3; j++) expect(analytic[i * n + j]).toBe(0);
    }
  });

  it("has an acceleration term matching the change of the Jacobian along the motion", () => {
    const h = 1e-6;
    const plus = jacobianOf(c, shifted(qd, h));
    const minus = jacobianOf(c, shifted(qd, -h));
    const analytic = new Float64Array(c.size);
    c.accelerationRhs(q, qd, analytic, 0);
    for (let i = 0; i < c.size; i++) {
      let numeric = 0;
      for (let j = 0; j < n; j++)
        numeric -= ((plus[i * n + j] - minus[i * n + j]) / (2 * h)) * qd[j];
      expect(Math.abs(analytic[i] - numeric)).toBeLessThan(1e-7);
    }
  });

  it("has a velocity term matching the change of the residual in time", () => {
    const h = 1e-6;
    const plus = residualOf(c, q, h);
    const minus = residualOf(c, q, -h);
    const analytic = new Float64Array(c.size);
    c.velocityRhs(analytic, 0);
    for (let i = 0; i < c.size; i++) {
      expect(Math.abs(analytic[i] + (plus[i] - minus[i]) / (2 * h))).toBeLessThan(1e-8);
    }
  });
});

describe("turning", () => {
  it("turns by an angle about an axis, and back", () => {
    const p = quaternion(unit([0, 0, 1]), Math.PI / 2);
    const turned = rotate(p, [1, 0, 0]);
    expect(turned[0]).toBeCloseTo(0, 14);
    expect(turned[1]).toBeCloseTo(1, 14);
    expect(turned[2]).toBeCloseTo(0, 14);
    const back = unrotate(p, turned);
    expect(back[0]).toBeCloseTo(1, 14);
    expect(back[1]).toBeCloseTo(0, 14);
  });

  it("makes a right-handed square frame about any axis", () => {
    for (const axis of [h1, h2, [0, 0, 1], [1, 0, 0], [0, -1, 0]] as Vec3[]) {
      const [f, g] = perpendiculars(axis);
      expect(dot(f, axis)).toBeCloseTo(0, 14);
      expect(dot(g, f)).toBeCloseTo(0, 14);
      expect(Math.hypot(...f)).toBeCloseTo(1, 14);
      const back = cross(f, g);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(axis[i] as number, 14);
    }
  });
});

const Z: Vec3 = [0, 0, 1];
const X: Vec3 = [1, 0, 0];

interface Rssr {
  model: SolverModel;
  /** Where the coupler's ball ends are, in its frame. */
  ends: [Vec3, Vec3];
}

/**
 * An RSSR four-bar: a crank turning about `z` at the origin, a rocker turning about
 * `axis` at `pivot`, and a coupler with a ball joint at each end. The crank and rocker
 * start along their arms `crank` and `rocker`; the coupler starts along the line
 * between their ends, its length the distance between them.
 */
function rssr(crank: Vec3, pivot: Vec3, axis: Vec3, rocker: Vec3, speed: number): Rssr {
  const [crankAt, couplerAt, rockerAt] = [0, SPATIAL_SIZE, 2 * SPATIAL_SIZE];
  const tipA = crank;
  const tipB: Vec3 = [pivot[0] + rocker[0], pivot[1] + rocker[1], pivot[2] + rocker[2]];
  const length = Math.hypot(tipB[0] - tipA[0], tipB[1] - tipA[1], tipB[2] - tipA[2]);
  const along = unit([tipB[0] - tipA[0], tipB[1] - tipA[1], tipB[2] - tipA[2]]);
  // The coupler's frame has its x axis along it: turn x onto `along`.
  const turnAxis = cross(X, along);
  const turnBy = Math.atan2(Math.hypot(...turnAxis), dot(X, along));
  const couplerTurn =
    Math.hypot(...turnAxis) < 1e-12 ? quaternion(Z, 0) : quaternion(unit(turnAxis), turnBy);

  const q0 = new Float64Array(3 * SPATIAL_SIZE);
  q0.set([0, 0, 0, 1, 0, 0, 0], crankAt);
  q0.set([...tipA, ...couplerTurn], couplerAt);
  q0.set([...pivot, 1, 0, 0, 0], rockerAt);
  const [f] = perpendiculars(Z);
  const ends: [Vec3, Vec3] = [
    [0, 0, 0],
    [length, 0, 0],
  ];
  return {
    ends,
    model: {
      bodies: [],
      spatial: [
        { id: "crank", size: SPATIAL_SIZE, points: [[0, 0, 0], crank] },
        { id: "coupler", size: SPATIAL_SIZE, points: ends },
        { id: "rocker", size: SPATIAL_SIZE, points: [[0, 0, 0], rocker] },
      ],
      constraints: [
        unitQuaternion("crank", crankAt),
        unitQuaternion("coupler", couplerAt),
        unitQuaternion("rocker", rockerAt),
        revolute("main", { at: -1, s: [0, 0, 0] }, { at: crankAt, s: [0, 0, 0] }, Z, Z),
        spherical("ball_a", { at: crankAt, s: crank }, { at: couplerAt, s: ends[0] }),
        spherical("ball_b", { at: couplerAt, s: ends[1] }, { at: rockerAt, s: rocker }),
        revolute("rock", { at: -1, s: pivot }, { at: rockerAt, s: [0, 0, 0] }, axis, axis),
        hingeAngle("motor", -1, crankAt, Z, f, f, 0, speed, true),
      ],
      q0,
    },
  };
}

/** The angle of a planar four-bar's rocker, from the crank angle, on the open branch. */
function planarRocker(crank: number, a: number, b: number, c: number, d: number): number {
  // Crank end, then the rocker end where the circles about it and the rocker pivot meet.
  const ax = a * Math.cos(crank);
  const ay = a * Math.sin(crank);
  const ex = d - ax;
  const ey = -ay;
  const e = Math.hypot(ex, ey);
  const beta = Math.acos((e * e + c * c - b * b) / (2 * e * c));
  return Math.atan2(-ey, -ex) - beta;
}

describe("an RSSR four-bar", () => {
  const speed = 2 * Math.PI;

  it("moves as a planar four-bar when its axes are parallel", () => {
    // The four-bar example: crank 40, coupler 160, rocker 110, frame 180 mm.
    const [a, b, c, d] = [0.04, 0.16, 0.11, 0.18];
    const start = planarRocker(0, a, b, c, d);
    const arm: Vec3 = [c * Math.cos(start), c * Math.sin(start), 0];
    const { model } = rssr([a, 0, 0], [d, 0, 0], Z, arm, speed);
    // The coupler is as long as in the example.
    const coupler = model.spatial?.[1]?.points ?? [];
    expect(Math.hypot(...(coupler[1] as Vec3))).toBeCloseTo(b, 12);

    const cycle = solveCycle(model, 1, 72);
    expect(cycle.count).toBe(72);
    const rocker = { at: 2 * SPATIAL_SIZE, s: arm };
    for (let k = 0; k < cycle.count; k++) {
      const at = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
      const [x, y, z] = placePoint(at, rocker);
      const angle = Math.atan2(y, x - d);
      expect(z).toBeCloseTo(0, 10);
      const expected = planarRocker((speed * k) / 72, a, b, c, d);
      expect(
        Math.abs(Math.atan2(Math.sin(angle - expected), Math.cos(angle - expected))),
      ).toBeLessThan(1e-9);
    }
  });

  // A skew case: the rocker turns about x, off to the side and above the crank.
  const ARM: Vec3 = [0, 0.03, -0.03 * Math.sqrt(3)];
  const skew = (): Rssr => rssr([0.02, 0, 0], [0.05, 0.06, 0.04], X, ARM, speed);

  it("assembles and keeps every joint closed over a turn of its crank", () => {
    const { model } = skew();
    const cycle = solveCycle(model, 1, 90);
    expect(cycle.failure).toBeUndefined();
    expect(cycle.count).toBe(90);
    for (let k = 0; k < cycle.count; k++) {
      const at = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
      expect(maxAbs(residual(model, at, cycle.t[k] as number))).toBeLessThan(1e-10);
    }
  });

  it("gives velocities and accelerations that match how its positions change", () => {
    const { model } = skew();
    const steps = 720;
    const cycle = solveCycle(model, 1, steps);
    const dt = 1 / steps;
    const w = cycle.width;
    // The rocker's ball end, followed by central differences.
    const ball = { at: 2 * SPATIAL_SIZE, s: ARM };
    const where = (k: number): Vec3 =>
      placePoint(
        cycle.q.subarray(((k + steps) % steps) * w, (((k + steps) % steps) + 1) * w),
        ball,
      );
    for (const k of [10, 200, 400, 650]) {
      const before = where(k - 1);
      const now = where(k);
      const after = where(k + 1);
      const q = cycle.q.subarray(k * w, (k + 1) * w);
      const qd = cycle.qd.subarray(k * w, (k + 1) * w);
      const qdd = cycle.qdd.subarray(k * w, (k + 1) * w);
      // Velocity and acceleration of the point from the solved rates.
      const h = 1e-6;
      const ahead = placePoint(
        q.map((value, i) => value + h * qd[i] + 0.5 * h * h * qdd[i]),
        ball,
      );
      const behind = placePoint(
        q.map((value, i) => value - h * qd[i] + 0.5 * h * h * qdd[i]),
        ball,
      );
      for (let i = 0; i < 3; i++) {
        const v = ((ahead[i] as number) - (behind[i] as number)) / (2 * h);
        const acc =
          ((ahead[i] as number) - 2 * (now[i] as number) + (behind[i] as number)) / (h * h);
        const vNumeric = ((after[i] as number) - (before[i] as number)) / (2 * dt);
        const aNumeric =
          ((after[i] as number) - 2 * (now[i] as number) + (before[i] as number)) / (dt * dt);
        expect(Math.abs(v - vNumeric)).toBeLessThan(1e-4 * 0.06 * speed);
        expect(Math.abs(acc - aNumeric)).toBeLessThan(2e-3 * 0.06 * speed * speed);
      }
    }
  });

  it("has one degree of freedom, and names the coupler's spin about its own line", () => {
    const { model } = skew();
    const q0 = Float64Array.from(model.q0);
    expect(solvePosition(model, q0, 0, 200).ok).toBe(true);
    expect(analyzeMobility(model, q0)).toEqual({
      coordinates: 21,
      mobility: 1,
      free: 0,
      freeBodies: [],
      idle: 1,
      idleBodies: ["coupler"],
      redundant: 0,
      redundantSources: [],
      blockedDrivers: [],
    });
  });

  it("does not count the spin as idle once the coupler has a point off its line", () => {
    const { model } = skew();
    const coupler = model.spatial?.[1];
    if (coupler?.points) coupler.points.push([0.01, 0.01, 0]);
    const q0 = Float64Array.from(model.q0);
    expect(solvePosition(model, q0, 0, 200).ok).toBe(true);
    expect(analyzeMobility(model, q0)).toMatchObject({
      mobility: 2,
      free: 1,
      freeBodies: ["coupler"],
      idle: 0,
    });
  });
});
