import {
  type BodyPoint,
  type CompiledBody,
  type Mat,
  mat,
  type Point,
  type Pose,
  place,
} from "@mekasim/core";
import type { CompiledContact, FitCompiled } from "../contacts.ts";
import { CONTACT_MARGIN, type ContactPoint, contactPoints } from "../geometry/contacts.ts";

/** `limit` is how far a pulled body may go in one sample; it is the run's own, and names nothing in a jam. */
export type InequalityKind = "contact" | "stop" | "lock" | "limit";

/** One current one-sided condition, written `value >= 0`. */
export interface Inequality {
  source: string;
  kind: InequalityKind;
  value: number;
  /** Derivative of value with respect to all moving-body coordinates. */
  gradient: Float64Array;
  /** The two bodies of the contact, or of the joint a stop or a lock is on, for a jam's message. */
  between?: [string, string];
}

/**
 * What a stop or a lock limits: the angle of a revolute joint, its second body's less
 * its first's, or how far a pin has gone along a slider or slot from the first point
 * of its axis.
 */
export type JointValue =
  | { kind: "angle"; a: number; b: number }
  | { kind: "travel"; from: BodyPoint; to: BodyPoint; pin: BodyPoint };

/** The limits of one joint; either end may be left open. */
export interface CompiledStop {
  joint: string;
  value: JointValue;
  low?: number;
  high?: number;
  bodies: [string, string];
}

/** A lock that drops in behind a joint once its value has passed `at`, and holds it there. */
export interface CompiledLock {
  id: string;
  joint: string;
  value: JointValue;
  at: number;
  /** `down`: in once the value falls below `at`, then holding it below. `up`: the other way round. */
  drops: "down" | "up";
  /** Whether it is in at the start. Not said, it is in where the joint starts beyond `at`. */
  engaged?: boolean;
  bodies: [string, string];
}

/** A joint's angle in rad or travel in metres at `q`, and its derivative when `gradient` is given to fill. */
export function jointValue(value: JointValue, q: Float64Array, gradient?: Float64Array): number {
  if (value.kind === "angle") {
    if (gradient) {
      if (value.a >= 0) gradient[3 * value.a + 2] -= 1;
      if (value.b >= 0) gradient[3 * value.b + 2] += 1;
    }
    return (
      (value.b < 0 ? 0 : (q[3 * value.b + 2] as number)) -
      (value.a < 0 ? 0 : (q[3 * value.a + 2] as number))
    );
  }
  const from = place(q, value.from);
  const to = place(q, value.to);
  const pin = place(q, value.pin);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const dx = pin.x - from.x;
  const dy = pin.y - from.y;
  if (gradient) {
    const axis = value.from.body;
    if (axis >= 0) {
      gradient[3 * axis] -= ux;
      gradient[3 * axis + 1] -= uy;
      // The first axis point moves as its body turns, and the axis turns with it.
      gradient[3 * axis + 2] += ux * from.by - uy * from.bx - dx * uy + dy * ux;
    }
    const sliding = value.pin.body;
    if (sliding >= 0) {
      gradient[3 * sliding] += ux;
      gradient[3 * sliding + 1] += uy;
      gradient[3 * sliding + 2] += -ux * pin.by + uy * pin.bx;
    }
  }
  return dx * ux + dy * uy;
}

/** A row that keeps a joint's value on one side of a limit: above it, or below. */
function limitRow(
  source: string,
  kind: "stop" | "lock",
  on: { value: JointValue; bodies: [string, string] },
  limit: number,
  above: boolean,
  q: Float64Array,
): Inequality {
  const gradient = new Float64Array(q.length);
  const value = jointValue(on.value, q, gradient);
  if (!above) for (let i = 0; i < gradient.length; i++) gradient[i] = -(gradient[i] as number);
  return {
    source,
    kind,
    value: above ? value - limit : limit - value,
    gradient,
    between: on.bodies,
  };
}

/** A row for each end of each joint's stops. */
export function stopInequalities(stops: CompiledStop[], q: Float64Array): Inequality[] {
  return stops.flatMap((stop) => [
    ...(stop.low === undefined ? [] : [limitRow(stop.joint, "stop", stop, stop.low, true, q)]),
    ...(stop.high === undefined ? [] : [limitRow(stop.joint, "stop", stop, stop.high, false, q)]),
  ]);
}

/** A row for each lock that is in, which holds its joint on the side it dropped in on. */
export function lockInequalities(
  locks: CompiledLock[],
  engaged: ReadonlySet<string>,
  q: Float64Array,
): Inequality[] {
  return locks
    .filter((lock) => engaged.has(lock.id))
    .map((lock) => limitRow(lock.id, "lock", lock, lock.at, lock.drops === "up", q));
}

export interface LinearizedInequalities {
  /** `G` in `G dq >= limits`. */
  normals: Mat;
  /** `-g` for each current value of a one-sided row. */
  limits: Float64Array;
}

function pose(body: CompiledBody, q: Float64Array): Pose {
  if (body.index < 0) return { x: 0, y: 0, angle: 0 };
  const at = 3 * body.index;
  return { x: q[at] as number, y: q[at + 1] as number, angle: q[at + 2] as number };
}

function addBodyGradient(
  gradient: Float64Array,
  body: number,
  origin: Pose,
  point: Point,
  normal: Point,
  sign: -1 | 1,
): void {
  if (body < 0) return;
  const at = 3 * body;
  const rx = point[0] - origin.x;
  const ry = point[1] - origin.y;
  gradient[at] += sign * normal[0];
  gradient[at + 1] += sign * normal[1];
  // d(point)/d(phi) = (-ry, rx).
  gradient[at + 2] += sign * (-normal[0] * ry + normal[1] * rx);
}

/** The linearized gap at one contact point. */
export function contactInequality(
  source: string,
  a: { id: string; body: number; origin: Pose },
  b: { id: string; body: number; origin: Pose },
  point: ContactPoint,
  width: number,
): Inequality {
  const gradient = new Float64Array(width);
  addBodyGradient(gradient, a.body, a.origin, point.a, point.normal, -1);
  addBodyGradient(gradient, b.body, b.origin, point.b, point.normal, 1);
  return {
    source,
    kind: "contact",
    value: point.distance,
    gradient,
    between: [a.id, b.id],
  };
}

function rowsOf(
  compiled: FitCompiled,
  contact: CompiledContact,
  q: Float64Array,
  margin: number,
): Inequality[] {
  const a = compiled.bodies.get(contact.a) as CompiledBody;
  const b = compiled.bodies.get(contact.b) as CompiledBody;
  const poseA = pose(a, q);
  const poseB = pose(b, q);
  const points = contactPoints(
    a.shape as NonNullable<CompiledBody["shape"]>,
    poseA,
    b.shape as NonNullable<CompiledBody["shape"]>,
    poseB,
    margin,
  );
  return points.map((point) =>
    contactInequality(
      contact.id,
      { id: a.id, body: a.index, origin: poseA },
      { id: b.id, body: b.index, origin: poseB },
      point,
      q.length,
    ),
  );
}

/** Contact rows near enough to matter at the current position. */
export function contactInequalities(
  compiled: FitCompiled,
  q: Float64Array,
  margin = CONTACT_MARGIN,
): Inequality[] {
  return compiled.contacts.flatMap((contact) => rowsOf(compiled, contact, q, margin));
}

/** Turn current one-sided values into the QP's linearized inequalities. */
export function linearizeInequalities(
  inequalities: Inequality[],
  width: number,
): LinearizedInequalities {
  const normals = mat(inequalities.length, width);
  const limits = new Float64Array(inequalities.length);
  inequalities.forEach((inequality, row) => {
    if (inequality.gradient.length !== width)
      throw new Error("An inequality gradient does not fit the mechanism coordinates");
    normals.data.set(inequality.gradient, row * width);
    limits[row] = -inequality.value;
  });
  return { normals, limits };
}
