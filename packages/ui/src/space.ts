import {
  type Compiled,
  type CompiledSpatialJoint,
  type Cycle,
  placeInSpace,
  SHEET,
  type SpatialBody,
  type SpatialPoint,
  turn,
  type Vec3,
} from "@mekasim/core";
import { label } from "./names.ts";

/** A body drawn in space: a body in space, or a body on a plane other than the sheet. */
export interface DrawSpaceBody {
  id: string;
  /** For its colour, counted on from the bodies on the sheet. */
  index: number;
  /** Its points, in its own frame. */
  points: { name: string; s: Vec3 }[];
  /** Rods from its first point to each of the others, in its own frame. */
  rods: [Vec3, Vec3][];
  /** Where it is at every sample: `[x, y, z, qx, qy, qz, qw]`, its origin and its turning. */
  poses: Float64Array;
  /** Names written beside its points, and its own at the middle of them, in its own frame. */
  labels: { text: string; body: boolean; s: Vec3 }[];
  /** Where the solver keeps it, to place it from coordinates of its own while it is posed. */
  place: SpatialBody;
}

/** A joint in space, drawn where it is in the world. */
export interface DrawSpaceJoint {
  id: string;
  kind: CompiledSpatialJoint["type"];
  driven: boolean;
  /** Where it is at every sample, three numbers each. */
  at: Float64Array;
  /** Which way it is drawn along at every sample: see `CompiledSpatialJoint.axis`. */
  axis?: Float64Array;
  /** The point it is drawn at, and the axis, as the solver places them. */
  point: SpatialPoint;
  along?: CompiledSpatialJoint["axis"];
}

export interface SpaceScene {
  bodies: DrawSpaceBody[];
  joints: DrawSpaceJoint[];
  /** Everything in space reaches, over the cycle. */
  min: Vec3;
  max: Vec3;
}

/** The quaternion `[x, y, z, w]` of a rotation given by the columns of its matrix. */
function quaternionOf(c0: Vec3, c1: Vec3, c2: Vec3): [number, number, number, number] {
  const [m00, m10, m20] = c0;
  const [m01, m11, m21] = c1;
  const [m02, m12, m22] = c2;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Where a body is for coordinates `q`: its origin into `out` at `at`, and its turning `[x, y, z, w]` returned. */
function poseOf(
  body: SpatialBody,
  q: Float64Array,
  out: Float64Array,
  at: number,
): [number, number, number, number] {
  out.set(placeInSpace(q, { ...body, s: [0, 0, 0] }), at);
  return quaternionOf(turn(q, body, [1, 0, 0]), turn(q, body, [0, 1, 0]), turn(q, body, [0, 0, 1]));
}

/** Where a body in space is for coordinates of its own, as `spacePoseAt` gives it from the cycle. */
export function spacePoseOf(body: DrawSpaceBody, q: Float64Array, out: Float64Array): void {
  out.set(poseOf(body.place, q, out, 0), 3);
}

/** Where a joint in space is for coordinates of its own, and which way its axis points. */
export function spaceJointOf(
  joint: DrawSpaceJoint,
  q: Float64Array,
  at: Float64Array,
  axis?: Float64Array,
): void {
  at.set(placeInSpace(q, joint.point));
  if (axis && joint.along) axis.set(turn(q, joint.along, joint.along.a));
}

/** What is drawn in space, from a compiled model and its solved cycle. */
export function buildSpace(compiled: Compiled, cycle: Cycle): SpaceScene | undefined {
  const { count, width } = cycle;
  const placed: { id: string; body: SpatialBody; points: { name: string; s: Vec3 }[] }[] = [];
  for (const body of compiled.spatial.values()) {
    const points = [...body.points].map(([name, s]) => ({ name, s }));
    placed.push({ id: body.id, body: { at: body.at }, points });
  }
  for (const body of compiled.planeBodies.values()) {
    const plane = body.plane === undefined ? SHEET : compiled.planes.get(body.plane);
    if (!plane || body.hidden) continue;
    const points = [...body.points].map(([name, { u, v }]) => ({ name, s: [u, v, 0] as Vec3 }));
    placed.push({ id: body.id, body: { at: 3 * body.index, plane }, points });
  }
  if (placed.length === 0 && compiled.spatialJoints.length === 0) return undefined;

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const reach = (p: Vec3): void => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, p[i] as number);
      max[i] = Math.max(max[i] as number, p[i] as number);
    }
  };
  const sample = (k: number): Float64Array => cycle.q.subarray(k * width, (k + 1) * width);

  // Two points held together are named once, by the first.
  const unnamed = new Set(
    compiled.spatialJoints
      .filter(
        (joint) =>
          joint.type === "spherical" || joint.type === "revolute" || joint.type === "universal",
      )
      .map((joint) => joint.points[1] as string),
  );
  const first = compiled.bodies.size;
  const bodies = placed.map(({ id, body, points }, i): DrawSpaceBody => {
    const poses = new Float64Array(7 * count);
    let previous: [number, number, number, number] | undefined;
    for (let k = 0; k < count; k++) {
      const q = sample(k);
      const turned = poseOf(body, q, poses, 7 * k);
      // Keep each turning on the same side as the last, so that it can be blended.
      if (previous && turned.reduce((sum, value, j) => sum + value * (previous?.[j] ?? 0), 0) < 0)
        for (let j = 0; j < 4; j++) turned[j] = -(turned[j] as number);
      previous = turned;
      poses.set(turned, 7 * k + 3);
      for (const { s } of points) reach(placeInSpace(q, { ...body, s }));
    }
    const [hub, ...ends] = points;
    const labels: DrawSpaceBody["labels"] = points
      .filter(({ name }) => !unnamed.has(`${id}.${name}`))
      .map(({ name, s }) => ({ text: label(name), body: false, s }));
    if (points.length > 1) {
      const middle: Vec3 = [0, 0, 0];
      for (const { s } of points)
        for (let j = 0; j < 3; j++)
          middle[j] = (middle[j] as number) + (s[j] as number) / points.length;
      labels.push({ text: label(id), body: true, s: middle });
    }
    return {
      id,
      index: first + i,
      points,
      rods: hub ? ends.map(({ s }): [Vec3, Vec3] => [hub.s, s]) : [],
      poses,
      labels,
      place: body,
    };
  });

  const driven = new Set(compiled.drivers.map((driver) => driver.joint));
  const joints = compiled.spatialJoints.map((joint): DrawSpaceJoint => {
    const at = new Float64Array(3 * count);
    const axis = joint.axis ? new Float64Array(3 * count) : undefined;
    for (let k = 0; k < count; k++) {
      const q = sample(k);
      const where = placeInSpace(q, joint.at as SpatialPoint);
      at.set(where, 3 * k);
      reach(where);
      if (axis && joint.axis) axis.set(turn(q, joint.axis, joint.axis.a), 3 * k);
    }
    return {
      id: joint.id,
      kind: joint.type,
      driven: driven.has(joint.id),
      at,
      ...(axis && { axis }),
      point: joint.at as SpatialPoint,
      ...(joint.axis && { along: joint.axis }),
    };
  });
  return { bodies, joints, min, max };
}

/** Where sample `step` falls, as two samples and how far between them. */
function between(step: number, count: number, periodic: boolean): [number, number, number] {
  const k0 = Math.min(Math.max(Math.floor(step), 0), count - 1);
  const next = k0 + 1 < count ? k0 + 1 : periodic ? 0 : k0;
  return [k0, next, Math.min(Math.max(step - k0, 0), 1)];
}

/** Where a body in space is at a fractional sample: `[x, y, z, qx, qy, qz, qw]` into `out`. */
export function spacePoseAt(
  body: DrawSpaceBody,
  step: number,
  periodic: boolean,
  out: Float64Array,
): void {
  const count = body.poses.length / 7;
  const [k0, k1, f] = between(step, count, periodic);
  const a = body.poses.subarray(7 * k0, 7 * k0 + 7);
  const b = body.poses.subarray(7 * k1, 7 * k1 + 7);
  for (let i = 0; i < 3; i++) out[i] = (a[i] as number) + f * ((b[i] as number) - (a[i] as number));
  // The turnings are blended and made of unit length again, the short way round.
  let dot = 0;
  for (let i = 3; i < 7; i++) dot += (a[i] as number) * (b[i] as number);
  const sign = dot < 0 ? -1 : 1;
  let size = 0;
  for (let i = 3; i < 7; i++) {
    out[i] = (a[i] as number) + f * (sign * (b[i] as number) - (a[i] as number));
    size += (out[i] as number) ** 2;
  }
  size = Math.sqrt(size) || 1;
  for (let i = 3; i < 7; i++) out[i] = (out[i] as number) / size;
}

/** Where a joint in space is at a fractional sample, and which way its axis points. */
export function spaceJointAt(
  joint: DrawSpaceJoint,
  step: number,
  periodic: boolean,
  at: Float64Array,
  axis?: Float64Array,
): void {
  const count = joint.at.length / 3;
  const [k0, k1, f] = between(step, count, periodic);
  for (let i = 0; i < 3; i++) {
    const a = joint.at[3 * k0 + i] as number;
    at[i] = a + f * ((joint.at[3 * k1 + i] as number) - a);
    if (axis && joint.axis) {
      const p = joint.axis[3 * k0 + i] as number;
      axis[i] = p + f * ((joint.axis[3 * k1 + i] as number) - p);
    }
  }
}

/** `v` turned by the unit quaternion `[qx, qy, qz, qw]` at `q[at]`. */
function rotateBy(q: ArrayLike<number>, at: number, v: Vec3, inverse = false): Vec3 {
  const sign = inverse ? -1 : 1;
  const u: Vec3 = [
    sign * (q[at] as number),
    sign * (q[at + 1] as number),
    sign * (q[at + 2] as number),
  ];
  const w = q[at + 3] as number;
  // v' = v + 2 w (u × v) + 2 u × (u × v).
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const t = cross(u, v).map((value) => 2 * value) as Vec3;
  const c = cross(u, t);
  return [v[0] + w * t[0] + c[0], v[1] + w * t[1] + c[1], v[2] + w * t[2] + c[2]];
}

/** Where a point of a body in space, `s` in its own frame, is at every sample: three numbers each. */
export function spacePath(body: DrawSpaceBody, s: Vec3): Float64Array {
  const count = body.poses.length / 7;
  const out = new Float64Array(3 * count);
  for (let k = 0; k < count; k++) {
    const turned = rotateBy(body.poses, 7 * k + 3, s);
    for (let i = 0; i < 3; i++) out[3 * k + i] = (body.poses[7 * k + i] as number) + turned[i];
  }
  return out;
}

/** A place in the world seen in a body's own frame, with the body where it is at `step`. */
export function toSpaceLocal(
  body: DrawSpaceBody,
  step: number,
  periodic: boolean,
  world: Vec3,
): Vec3 {
  const pose = new Float64Array(7);
  spacePoseAt(body, step, periodic, pose);
  const d: Vec3 = [
    world[0] - (pose[0] as number),
    world[1] - (pose[1] as number),
    world[2] - (pose[2] as number),
  ];
  return rotateBy(pose, 3, d, true);
}
