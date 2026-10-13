import { type CompiledBody, type Mat, mat, type Point, type Pose } from "@mekasim/core";
import type { CompiledContact, FitCompiled } from "../contacts.ts";
import { CONTACT_MARGIN, type ContactPoint, contactPoints } from "../geometry/contacts.ts";

export type InequalityKind = "contact" | "stop" | "lock";

/** One current one-sided condition, written `value >= 0`. */
export interface Inequality {
  source: string;
  kind: InequalityKind;
  value: number;
  /** Derivative of value with respect to all moving-body coordinates. */
  gradient: Float64Array;
  /** The bodies involved in a contact, for a useful jam message later. */
  between?: [string, string];
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
