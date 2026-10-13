/** Dense row-major matrix. Mechanism models are small, so nothing sparse is needed. */
export interface Mat {
  rows: number;
  cols: number;
  data: Float64Array;
}

export function mat(rows: number, cols: number): Mat {
  return { rows, cols, data: new Float64Array(rows * cols) };
}

export function matFrom(rows: number[][]): Mat {
  const m = mat(rows.length, rows[0]?.length ?? 0);
  rows.forEach((row, i) => {
    m.data.set(row, i * m.cols);
  });
  return m;
}

export function maxAbs(v: Float64Array): number {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  return max;
}

export function norm2(v: Float64Array): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/**
 * Solve the square system `a x = b` by Gaussian elimination with partial pivoting.
 * Returns null when `a` is singular or close to it, so the caller can fall back to
 * the pseudo-inverse.
 */
export function luSolve(a: Mat, b: Float64Array): Float64Array | null {
  const n = a.rows;
  const lu = Float64Array.from(a.data);
  const x = Float64Array.from(b);
  const threshold = maxAbs(lu) * 1e-10;

  for (let k = 0; k < n; k++) {
    let pivot = k;
    let best = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const value = Math.abs(lu[i * n + k]);
      if (value > best) {
        best = value;
        pivot = i;
      }
    }
    if (best <= threshold) return null;
    if (pivot !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = lu[k * n + j];
        lu[k * n + j] = lu[pivot * n + j];
        lu[pivot * n + j] = tmp;
      }
      const tmp = x[k];
      x[k] = x[pivot];
      x[pivot] = tmp;
    }
    const diag = lu[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const factor = lu[i * n + k] / diag;
      if (factor === 0) continue;
      for (let j = k + 1; j < n; j++) {
        lu[i * n + j] = lu[i * n + j] - factor * lu[k * n + j];
      }
      x[i] = x[i] - factor * x[k];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i];
    for (let j = i + 1; j < n; j++) sum -= lu[i * n + j] * x[j];
    x[i] = sum / lu[i * n + i];
  }
  return x;
}

/**
 * Singular value decomposition `a = u diag(s) v^T`.
 * `u` has `max(a.rows, a.cols)` rows: a wide matrix is padded with zero rows so that
 * `v` always spans the whole coordinate space, null space included. Singular values
 * are not sorted.
 */
export interface Svd {
  u: Mat;
  s: Float64Array;
  v: Mat;
}

/** One-sided Jacobi SVD. Slow for large matrices, accurate and simple for small ones. */
export function svd(a: Mat): Svd {
  const n = a.cols;
  const m = Math.max(a.rows, n);
  const u = mat(m, n);
  u.data.set(a.data);
  const v = mat(n, n);
  for (let i = 0; i < n; i++) v.data[i * n + i] = 1;
  const ud = u.data;
  const vd = v.data;

  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          const up = ud[i * n + p];
          const uq = ud[i * n + q];
          alpha += up * up;
          beta += uq * uq;
          gamma += up * uq;
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const up = ud[i * n + p];
          const uq = ud[i * n + q];
          ud[i * n + p] = c * up - s * uq;
          ud[i * n + q] = s * up + c * uq;
        }
        for (let i = 0; i < n; i++) {
          const vp = vd[i * n + p];
          const vq = vd[i * n + q];
          vd[i * n + p] = c * vp - s * vq;
          vd[i * n + q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }

  const s = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < m; i++) sum += ud[i * n + j] ** 2;
    const sigma = Math.sqrt(sum);
    s[j] = sigma;
    if (sigma > 0) for (let i = 0; i < m; i++) ud[i * n + j] = ud[i * n + j] / sigma;
  }
  return { u, s, v };
}

/** Singular values below `RANK_TOLERANCE` times the largest count as zero. */
export const RANK_TOLERANCE = 1e-9;

export function rankOf(decomposition: Svd, tolerance = RANK_TOLERANCE): number {
  const cutoff = maxAbs(decomposition.s) * tolerance;
  let rank = 0;
  for (const sigma of decomposition.s) if (sigma > cutoff) rank++;
  return rank;
}

/**
 * The directions that `a x = 0` leaves free, from the decomposition of `a`: a matrix
 * whose columns are an orthonormal basis of them. It has no columns when `a` fixes
 * every direction.
 */
export function nullSpace(decomposition: Svd, tolerance = RANK_TOLERANCE): Mat {
  const { s, v } = decomposition;
  const n = v.rows;
  const cutoff = maxAbs(s) * tolerance;
  const free: number[] = [];
  for (let j = 0; j < n; j++) if (s[j] <= cutoff) free.push(j);
  const out = mat(n, free.length);
  free.forEach((j, column) => {
    for (let i = 0; i < n; i++) out.data[i * free.length + column] = v.data[i * n + j];
  });
  return out;
}

/**
 * Minimum-norm least-squares solution of `a x = b` from the decomposition of `a`.
 * Handles redundant rows and free columns alike.
 */
export function pinvSolve(
  decomposition: Svd,
  b: Float64Array,
  tolerance = RANK_TOLERANCE,
): Float64Array {
  const { u, s, v } = decomposition;
  const n = v.rows;
  const x = new Float64Array(n);
  const cutoff = maxAbs(s) * tolerance;
  for (let j = 0; j < n; j++) {
    const sigma = s[j];
    if (sigma <= cutoff) continue;
    let dot = 0;
    for (let i = 0; i < b.length; i++) dot += u.data[i * n + j] * b[i];
    const coef = dot / sigma;
    for (let i = 0; i < n; i++) x[i] = x[i] + coef * v.data[i * n + j];
  }
  return x;
}

/** Solve `a x = b`: direct when `a` is square and regular, pseudo-inverse otherwise. */
export function solveLinear(a: Mat, b: Float64Array): Float64Array {
  if (a.rows === a.cols) {
    const x = luSolve(a, b);
    if (x) return x;
  }
  return pinvSolve(svd(a), b);
}
