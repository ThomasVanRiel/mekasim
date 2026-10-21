import { type Mat, mat, nullSpace, RANK_TOLERANCE, rankOf, type Svd, svd } from "./linalg.ts";
import { blocks, jacobian, rowCount, type SolverModel } from "./solve.ts";
import { pointRate } from "./spatial.ts";

export interface Mobility {
  /** Coordinates of all moving bodies. */
  coordinates: number;
  /** Degrees of freedom of the mechanism with its drivers removed. */
  mobility: number;
  /** Degrees of freedom left once the drivers are applied. 0 means fully determined. */
  free: number;
  /** Bodies that take part in the remaining free motion. */
  freeBodies: string[];
  /**
   * Free motions that move nothing, such as a rod between two ball joints spinning
   * about its own line. They are left out of `mobility` and `free`.
   */
  idle: number;
  /** Bodies that can move in those ways. */
  idleBodies: string[];
  /** Constraint equations that add nothing because others already imply them. */
  redundant: number;
  /** Joints whose equations overlap with those of the others. */
  redundantSources: string[];
  /** Drivers that find no freedom to act on. */
  blockedDrivers: string[];
}

/** Rates below this, for coordinates changing at unit speed, count as standing still. */
const STILL = 1e-9;

/**
 * What can be seen of a motion of the coordinates: the coordinates of a planar body or
 * of any other block themselves, and for a body in space the velocities of its points
 * (its origin, if it has none). One row per thing seen, one column per coordinate.
 */
function seen(model: SolverModel, q: Float64Array): Mat {
  const n = q.length;
  const rows: Float64Array[] = [];
  for (const { at, size, points } of blocks(model)) {
    if (!points) {
      for (let k = 0; k < size; k++) {
        const row = new Float64Array(n);
        row[at + k] = 1;
        rows.push(row);
      }
      continue;
    }
    const ends = points.length > 0 ? points : [[0, 0, 0] as const];
    const rate = new Float64Array(n);
    for (const s of ends) {
      const out = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
      for (let k = 0; k < size; k++) {
        rate.fill(0);
        rate[at + k] = 1;
        const v = pointRate(q, rate, at, [s[0], s[1], s[2]]);
        for (let i = 0; i < 3; i++) out[i][at + k] = v[i];
      }
      rows.push(...out);
    }
  }
  const out = mat(rows.length, n);
  rows.forEach((row, i) => {
    out.data.set(row, i * n);
  });
  return out;
}

/**
 * Split the free motions, the columns of `free`, into those that move something and
 * those that do not. Returns how many move nothing, and a basis of those that do.
 */
function split(view: Mat, free: Mat): { idle: number; moving: Mat; still: Mat } {
  const k = free.cols;
  const n = free.rows;
  if (k === 0) return { idle: 0, moving: free, still: mat(n, 0) };
  // What each free motion is seen to do.
  const shown = mat(view.rows, k);
  for (let i = 0; i < view.rows; i++) {
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let c = 0; c < n; c++) sum += view.data[i * n + c] * free.data[c * k + j];
      shown.data[i * k + j] = sum;
    }
  }
  const { s, v } = svd(shown);
  const moves: number[] = [];
  const stays: number[] = [];
  s.forEach((sigma, j) => {
    (sigma > STILL ? moves : stays).push(j);
  });
  const combine = (which: number[]): Mat => {
    const out = mat(n, which.length);
    which.forEach((j, column) => {
      for (let c = 0; c < n; c++) {
        let sum = 0;
        for (let m = 0; m < k; m++) sum += free.data[c * k + m] * v.data[m * k + j];
        out.data[c * which.length + column] = sum;
      }
    });
    return out;
  };
  return { idle: stays.length, moving: combine(moves), still: combine(stays) };
}

/** The bodies that a set of motions, the columns of `motions`, moves. */
function bodiesIn(model: SolverModel, motions: Mat, into: Set<string>): void {
  const k = motions.cols;
  for (let j = 0; j < k; j++) {
    for (const { id, at, size } of blocks(model)) {
      for (let c = at; c < at + size; c++) {
        if (Math.abs(motions.data[c * k + j]) > 1e-6) into.add(id);
      }
    }
  }
}

/**
 * Count degrees of freedom from the rank of the constraint Jacobian at position `q`.
 * Unlike a joint-counting formula this sees redundant constraints and special
 * geometry, but it describes this position only: at a dead point the rank drops.
 */
export function analyzeMobility(model: SolverModel, q: Float64Array): Mobility {
  const n = q.length;
  const joints = model.constraints.filter((c) => !c.driver);
  const drivers = model.constraints.filter((c) => c.driver);
  const spatial = blocks(model).some((block) => block.points);

  const rank = (constraints = model.constraints): number =>
    constraints.length === 0 || n === 0 ? 0 : rankOf(svd(jacobian(model, q, constraints)));

  /** The motions the constraints leave free, and how many of them move nothing. */
  const freedom = (decomposition: Svd | undefined): ReturnType<typeof split> => {
    const free = decomposition ? nullSpace(decomposition) : identity(n);
    return spatial ? split(seen(model, q), free) : { idle: 0, moving: free, still: mat(n, 0) };
  };

  const jointSvd = joints.length > 0 && n > 0 ? svd(jacobian(model, q, joints)) : undefined;
  const jointRank = jointSvd ? rankOf(jointSvd) : 0;
  const full = n === 0 ? undefined : svd(jacobian(model, q));
  const fullRank = full && model.constraints.length > 0 ? rankOf(full) : 0;

  const freeBodies = new Set<string>();
  const idleBodies = new Set<string>();
  let idle = 0;
  if (full) {
    const motions = freedom(model.constraints.length > 0 ? full : undefined);
    idle = motions.idle;
    if (idle === 0) {
      const cutoff = Math.max(...full.s) * RANK_TOLERANCE;
      full.s.forEach((sigma, j) => {
        if (sigma > cutoff) return;
        for (const { id, at, size } of blocks(model)) {
          for (let k = at; k < at + size; k++) {
            if (Math.abs(full.v.data[k * n + j]) > 1e-6) freeBodies.add(id);
          }
        }
      });
    } else {
      bodiesIn(model, motions.moving, freeBodies);
      bodiesIn(model, motions.still, idleBodies);
    }
  }
  const jointIdle = spatial && n > 0 ? freedom(jointSvd).idle : 0;

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
    mobility: n - jointRank - jointIdle,
    free: n - fullRank - idle,
    freeBodies: [...freeBodies],
    idle,
    idleBodies: [...idleBodies],
    redundant,
    redundantSources,
    blockedDrivers,
  };
}

function identity(n: number): Mat {
  const out = mat(n, n);
  for (let i = 0; i < n; i++) out.data[i * n + i] = 1;
  return out;
}
