import { type BodyPoint, type Mat, mat, type Placed, place } from "@mekasim/core";

/** A spring on the relative angle of a revolute joint. */
export interface TorsionSpring {
  id: string;
  kind: "torsion";
  /** The joint's two bodies as solver indices; its angle is that of `b` less that of `a`. */
  a: number;
  b: number;
  /** In N·m/rad. */
  stiffness: number;
  /** The joint angle at which it pushes nothing, in rad. */
  rest: number;
}

/** A spring on the distance between two points. */
export interface StraightSpring {
  id: string;
  kind: "straight";
  a: BodyPoint;
  b: BodyPoint;
  /** In N/m. */
  stiffness: number;
  /** The length at which it pushes nothing, in metres. Below zero for a spring wound with tension in it. */
  rest: number;
}

export type CompiledSpring = TorsionSpring | StraightSpring;

/** What the springs add to the quadratic program at one position. */
export interface SpringTerms {
  energy: number;
  /** Derivative of the energy with respect to all moving-body coordinates. */
  gradient: Float64Array;
  /** Symmetric and never negative, whatever the springs' loads. */
  hessian: Mat;
}

/** A length below this has no direction, in metres. */
const NO_LENGTH = 1e-12;

function angleOf(q: Float64Array, body: number): number {
  return body < 0 ? 0 : (q[3 * body + 2] as number);
}

/** What a spring acts on: its joint's angle in rad, or the distance between its points in metres. */
export function springValue(spring: CompiledSpring, q: Float64Array): number {
  if (spring.kind === "torsion") return angleOf(q, spring.b) - angleOf(q, spring.a);
  const a = place(q, spring.a);
  const b = place(q, spring.b);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** `sign` times the derivative of a body's point along `direction`, added to `row`. */
function addPoint(
  row: Float64Array,
  body: number,
  at: Placed,
  [dx, dy]: readonly [number, number],
  sign: number,
): void {
  if (body < 0) return;
  row[3 * body] += sign * dx;
  row[3 * body + 1] += sign * dy;
  // d(point)/d(phi) = (-by, bx).
  row[3 * body + 2] += sign * (-dx * at.by + dy * at.bx);
}

/**
 * Derivative of `springValue` with respect to all moving-body coordinates. For a
 * straight spring also `across`: how fast its second end moves sideways of its line
 * relative to the first, and its length.
 */
function valueGradient(
  spring: CompiledSpring,
  q: Float64Array,
): { along: Float64Array; across?: Float64Array; length?: number } {
  const along = new Float64Array(q.length);
  if (spring.kind === "torsion") {
    if (spring.a >= 0) along[3 * spring.a + 2] -= 1;
    if (spring.b >= 0) along[3 * spring.b + 2] += 1;
    return { along };
  }
  const a = place(q, spring.a);
  const b = place(q, spring.b);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // Two points on one place pull no particular way.
  if (length < NO_LENGTH) return { along };
  const nx = (b.x - a.x) / length;
  const ny = (b.y - a.y) / length;
  const across = new Float64Array(q.length);
  addPoint(along, spring.a.body, a, [nx, ny], -1);
  addPoint(along, spring.b.body, b, [nx, ny], 1);
  addPoint(across, spring.a.body, a, [-ny, nx], -1);
  addPoint(across, spring.b.body, b, [-ny, nx], 1);
  return { along, across, length };
}

/**
 * The springs' energy at `q`, with its gradient and a Hessian that is never negative.
 * It is the Gauss-Newton one, with the stiffness a stretched straight spring has
 * sideways of its line added: its tension over its length. What is left out is how
 * a turning body carries the spring's end round, and the sideways term of a spring
 * that is pushed short, which would make the Hessian negative.
 */
export function springTerms(springs: CompiledSpring[], q: Float64Array): SpringTerms {
  const width = q.length;
  const gradient = new Float64Array(width);
  const hessian = mat(width, width);
  let energy = 0;

  const add = (row: Float64Array, stiffness: number): void => {
    for (let i = 0; i < width; i++) {
      const di = row[i] as number;
      if (di === 0) continue;
      for (let j = 0; j < width; j++)
        hessian.data[i * width + j] += stiffness * di * (row[j] as number);
    }
  };

  for (const spring of springs) {
    const stretch = springValue(spring, q) - spring.rest;
    const { along, across, length } = valueGradient(spring, q);
    energy += 0.5 * spring.stiffness * stretch * stretch;
    for (let i = 0; i < width; i++)
      gradient[i] += spring.stiffness * stretch * (along[i] as number);
    add(along, spring.stiffness);
    if (across && length && stretch > 0) add(across, (spring.stiffness * stretch) / length);
  }
  return { energy, gradient, hessian };
}
