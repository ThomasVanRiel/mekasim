/**
 * Seeded random numbers for studies: splitmix32 seeds a xoshiro128** generator, as
 * their authors advise. The same keys always give the same numbers, on any machine.
 */

/** One step of splitmix32 from `state`: the next state and the number it gives. */
function splitmix32(state: number): [next: number, value: number] {
  const next = (state + 0x9e3779b9) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return [next, (z ^ (z >>> 15)) >>> 0];
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export interface Random {
  /** The next 32 bits, as a whole number from 0 to 2^32 - 1. */
  next(): number;
  /** A number from 0 up to, not including, 1. */
  uniform(): number;
  /** A number drawn from the normal distribution with mean 0 and standard deviation 1. */
  normal(): number;
  /** A whole number from 0 up to, not including, `count`. */
  pick(count: number): number;
}

/** xoshiro128** from its four words of state, which must not all be 0. */
export function xoshiro128(state: [number, number, number, number]): Random {
  let [s0, s1, s2, s3] = state.map((word) => word | 0) as [number, number, number, number];
  function next(): number {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  }
  function uniform(): number {
    return next() / 2 ** 32;
  }
  return {
    next,
    uniform,
    // Box–Muller; 1 - u keeps the logarithm away from 0.
    normal: () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform()),
    pick: (count) => Math.floor(uniform() * count),
  };
}

/**
 * A generator for the given keys, such as a seed, a stream and a run's number. The
 * keys are folded through splitmix32, which then fills the generator's state.
 */
export function random(...keys: number[]): Random {
  let state = 0;
  for (const key of keys) {
    const [, mixed] = splitmix32(state ^ (key | 0));
    state = mixed;
  }
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [next, value] = splitmix32(state);
    state = next;
    words.push(value);
  }
  return xoshiro128(words as [number, number, number, number]);
}

/**
 * The value below which a share `p` of the standard normal distribution lies
 * (Acklam's approximation, to about 1e-9 of its value).
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const [a0, a1, a2, a3, a4, a5] = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const [b0, b1, b2, b3, b4] = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
    (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
  );
}

/** The lower tail of `normalQuantile`, in terms of sqrt(-2 ln p). */
function tail(q: number): number {
  const [c0, c1, c2, c3, c4, c5] = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const [d0, d1, d2, d3] = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416,
  ];
  return (
    (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
    ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
  );
}
