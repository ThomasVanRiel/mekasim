import { type BodyPoint, type Mat, mat, place } from "@mekasim/core";

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
  /** Gauss-Newton Hessian: symmetric and never negative, whatever the springs' loads. */
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

/** Derivative of `springValue` with respect to all moving-body coordinates. */
function valueGradient(spring: CompiledSpring, q: Float64Array): Float64Array {
  const gradient = new Float64Array(q.length);
  if (spring.kind === "torsion") {
    if (spring.a >= 0) gradient[3 * spring.a + 2] -= 1;
    if (spring.b >= 0) gradient[3 * spring.b + 2] += 1;
    return gradient;
  }
  const a = place(q, spring.a);
  const b = place(q, spring.b);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // Two points on one place pull no particular way.
  if (length < NO_LENGTH) return gradient;
  const nx = (b.x - a.x) / length;
  const ny = (b.y - a.y) / length;
  for (const [body, end, sign] of [
    [spring.a.body, a, -1],
    [spring.b.body, b, 1],
  ] as const) {
    if (body < 0) continue;
    gradient[3 * body] += sign * nx;
    gradient[3 * body + 1] += sign * ny;
    // d(point)/d(phi) = (-by, bx).
    gradient[3 * body + 2] += sign * (-nx * end.by + ny * end.bx);
  }
  return gradient;
}

/**
 * The springs' energy at `q`, with its gradient and Gauss-Newton Hessian. The Hessian
 * leaves out the term in which a loaded straight spring's direction turns, so it is
 * exact for torsion springs and for straight springs at their rest length.
 */
export function springTerms(springs: CompiledSpring[], q: Float64Array): SpringTerms {
  const width = q.length;
  const gradient = new Float64Array(width);
  const hessian = mat(width, width);
  let energy = 0;

  for (const spring of springs) {
    const stretch = springValue(spring, q) - spring.rest;
    const row = valueGradient(spring, q);
    energy += 0.5 * spring.stiffness * stretch * stretch;
    for (let i = 0; i < width; i++) {
      const di = row[i] as number;
      if (di === 0) continue;
      gradient[i] += spring.stiffness * stretch * di;
      for (let j = 0; j < width; j++) {
        hessian.data[i * width + j] += spring.stiffness * di * (row[j] as number);
      }
    }
  }
  return { energy, gradient, hessian };
}
