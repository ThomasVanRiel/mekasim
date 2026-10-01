import type { BodyPoint } from "./constraints.ts";
import { mat, maxAbs, pinvSolve, RANK_TOLERANCE, svd } from "./linalg.ts";
import { jacobian, type SolverModel, solvePosition } from "./solve.ts";

/** World position of a body point, and its offset from the body origin rotated into the world. */
function locate(q: Float64Array, p: BodyPoint): { x: number; y: number; bx: number; by: number } {
  if (p.body < 0) return { x: p.u, y: p.v, bx: 0, by: 0 };
  const i = 3 * p.body;
  const c = Math.cos(q[i + 2]);
  const s = Math.sin(q[i + 2]);
  const bx = p.u * c - p.v * s;
  const by = p.u * s + p.v * c;
  return { x: q[i] + bx, y: q[i + 1] + by, bx, by };
}

/** Largest rotation of any body in one step, so the mechanism cannot flip to another assembly. */
const MAX_TURN = 0.3;

/**
 * Pull a point of the mechanism towards a target, as when dragging it with the
 * mouse. Drivers are ignored; every joint stays closed. The bodies move only in the
 * ways the joints leave free, and the point ends as near the target as those allow.
 *
 * Updates `q` in place and returns the remaining distance to the target.
 */
export function dragTo(
  model: SolverModel,
  q: Float64Array,
  point: BodyPoint,
  x: number,
  y: number,
): number {
  const joints: SolverModel = { ...model, constraints: model.constraints.filter((c) => !c.driver) };
  const n = q.length;
  let distance = Math.hypot(x - locate(q, point).x, y - locate(q, point).y);
  if (point.body < 0 || n === 0) return distance;

  for (let iteration = 0; iteration < 25 && distance > 1e-9; iteration++) {
    // The free motions are the directions the joint equations do not resist.
    const decomposition = svd(jacobian(joints, q));
    const cutoff = joints.constraints.length > 0 ? maxAbs(decomposition.s) * RANK_TOLERANCE : -1;
    const free: number[] = [];
    decomposition.s.forEach((sigma, j) => {
      if (sigma <= cutoff || joints.constraints.length === 0) free.push(j);
    });
    if (free.length === 0) break;

    // How the dragged point moves for each free motion.
    const at = locate(q, point);
    const col = 3 * point.body;
    const reach = mat(2, free.length);
    free.forEach((j, k) => {
      const dx = decomposition.v.data[col * n + j];
      const dy = decomposition.v.data[(col + 1) * n + j];
      const dphi = decomposition.v.data[(col + 2) * n + j];
      reach.data[k] = dx - at.by * dphi;
      reach.data[free.length + k] = dy + at.bx * dphi;
    });
    const amounts = pinvSolve(svd(reach), Float64Array.of(x - at.x, y - at.y));
    const step = new Float64Array(n);
    free.forEach((j, k) => {
      for (let i = 0; i < n; i++) step[i] += amounts[k] * decomposition.v.data[i * n + j];
    });

    let turn = 0;
    for (let i = 2; i < n; i += 3) turn = Math.max(turn, Math.abs(step[i]));
    let scale = turn > MAX_TURN ? MAX_TURN / turn : 1;

    // The step is along a tangent; closing the joints again pulls it back onto the true path.
    let moved = false;
    for (let attempt = 0; attempt < 6; attempt++, scale /= 2) {
      const trial = q.map((value, i) => value + scale * step[i]);
      if (!solvePosition(joints, trial, 0).ok) continue;
      const reached = locate(trial, point);
      const remaining = Math.hypot(x - reached.x, y - reached.y);
      if (remaining < distance - 1e-12) {
        q.set(trial);
        distance = remaining;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return distance;
}
