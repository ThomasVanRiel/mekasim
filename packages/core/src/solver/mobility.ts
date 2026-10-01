import { RANK_TOLERANCE, rankOf, svd } from "./linalg.ts";
import { jacobian, rowCount, type SolverModel } from "./solve.ts";

export interface Mobility {
  /** Coordinates of all moving bodies. */
  coordinates: number;
  /** Degrees of freedom of the mechanism with its drivers removed. */
  mobility: number;
  /** Degrees of freedom left once the drivers are applied. 0 means fully determined. */
  free: number;
  /** Bodies that take part in the remaining free motion. */
  freeBodies: string[];
  /** Constraint equations that add nothing because others already imply them. */
  redundant: number;
  /** Joints whose equations overlap with those of the others. */
  redundantSources: string[];
  /** Drivers that find no freedom to act on. */
  blockedDrivers: string[];
}

/**
 * Count degrees of freedom from the rank of the constraint Jacobian at position `q`.
 * Unlike a joint-counting formula this sees redundant constraints and special
 * geometry, but it describes this position only: at a dead point the rank drops.
 */
export function analyzeMobility(model: SolverModel, q: Float64Array): Mobility {
  const n = 3 * model.bodies.length;
  const joints = model.constraints.filter((c) => !c.driver);
  const drivers = model.constraints.filter((c) => c.driver);

  const rank = (constraints = model.constraints): number =>
    constraints.length === 0 || n === 0 ? 0 : rankOf(svd(jacobian(model, q, constraints)));

  const jointRank = rank(joints);
  const full = n === 0 ? undefined : svd(jacobian(model, q));
  const fullRank = full && model.constraints.length > 0 ? rankOf(full) : 0;

  const freeBodies = new Set<string>();
  if (full) {
    const cutoff = Math.max(...full.s) * RANK_TOLERANCE;
    full.s.forEach((sigma, j) => {
      if (sigma > cutoff) return;
      model.bodies.forEach((id, b) => {
        for (let k = 0; k < 3; k++) {
          if (Math.abs(full.v.data[(3 * b + k) * n + j]) > 1e-6) freeBodies.add(id);
        }
      });
    });
  }

  const redundant = rowCount(joints) - jointRank;
  const redundantSources: string[] = [];
  if (redundant > 0) {
    // A joint takes part when removing it costs less rank than it has equations.
    for (const source of new Set(joints.map((c) => c.source))) {
      const others = joints.filter((c) => c.source !== source);
      const size = rowCount(joints) - rowCount(others);
      if (rank(others) > jointRank - size) redundantSources.push(source);
    }
  }

  const blockedDrivers = drivers
    .filter((driver) => rank([...joints, driver]) === jointRank)
    .map((driver) => driver.source);

  return {
    coordinates: n,
    mobility: n - jointRank,
    free: n - fullRank,
    freeBodies: [...freeBodies],
    redundant,
    redundantSources,
    blockedDrivers,
  };
}
