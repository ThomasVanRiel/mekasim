import type { CamProfile } from "./constraints.ts";

/** How the follower moves between two points of the lift diagram. */
export type CamLaw = "cycloidal" | "harmonic" | "polynomial";

/** A blend from 0 to 1 over `u` in 0..1, with its first and second derivatives. */
type Blend = (u: number) => [value: number, first: number, second: number];

const BLENDS: Record<CamLaw, Blend> = {
  // Starts and ends with no speed and no acceleration: the gentlest of the three.
  cycloidal: (u) => [
    u - Math.sin(2 * Math.PI * u) / (2 * Math.PI),
    1 - Math.cos(2 * Math.PI * u),
    2 * Math.PI * Math.sin(2 * Math.PI * u),
  ],
  // Simple harmonic motion: no speed at the ends, but acceleration jumps there.
  harmonic: (u) => [
    (1 - Math.cos(Math.PI * u)) / 2,
    (Math.PI * Math.sin(Math.PI * u)) / 2,
    (Math.PI * Math.PI * Math.cos(Math.PI * u)) / 2,
  ],
  // The 3-4-5 polynomial: no speed and no acceleration at the ends.
  polynomial: (u) => [
    10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5,
    30 * u ** 2 - 60 * u ** 3 + 30 * u ** 4,
    60 * u - 180 * u ** 2 + 120 * u ** 3,
  ],
};

export interface CamKnot {
  /** Angle around the cam, in radians, in 0..2 pi. */
  angle: number;
  /** Lift above the base radius at that angle, in metres. */
  lift: number;
}

/**
 * The pitch curve of a cam from its lift diagram: the lift is given at a few
 * angles, rising and falling between them by the chosen law, and staying level
 * between two angles with the same lift. `knots` must be in rising order of angle.
 */
export function camProfile(base: number, knots: CamKnot[], law: CamLaw): CamProfile {
  const blend = BLENDS[law];
  const turn = 2 * Math.PI;

  function at(theta: number): [number, number, number] {
    const first = knots[0];
    if (!first) return [base, 0, 0];
    const wrapped = ((theta % turn) + turn) % turn;
    // The stretch from the last knot runs through 0 to the first.
    let from = knots.at(-1) as CamKnot;
    let start = from.angle - turn;
    let to = first;
    let end = first.angle;
    for (let i = 0; i < knots.length; i++) {
      const knot = knots[i] as CamKnot;
      if (wrapped < knot.angle) break;
      from = knot;
      start = knot.angle;
      to = knots[i + 1] ?? first;
      end = knots[i + 1] ? to.angle : first.angle + turn;
    }
    const span = end - start;
    const rise = to.lift - from.lift;
    if (span <= 0 || rise === 0) return [base + from.lift, 0, 0];
    const [value, slope, curve] = blend((wrapped - start) / span);
    return [base + from.lift + rise * value, (rise * slope) / span, (rise * curve) / (span * span)];
  }

  return {
    radius: (theta) => at(theta)[0],
    slope: (theta) => at(theta)[1],
    curvature: (theta) => at(theta)[2],
  };
}

/**
 * The pitch curve and the cam's working surface as closed outlines in the cam's
 * frame. The surface is the pitch curve moved inwards by the roller radius.
 */
export function camOutlines(
  profile: CamProfile,
  roller: number,
  segments = 240,
): { pitch: [number, number][]; surface: [number, number][] } {
  const pitch: [number, number][] = [];
  const surface: [number, number][] = [];
  for (let k = 0; k < segments; k++) {
    const theta = (2 * Math.PI * k) / segments;
    const r = profile.radius(theta);
    const dr = profile.slope(theta);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    pitch.push([r * c, r * s]);
    // Tangent of the curve, and from it the normal pointing towards the centre.
    const tx = dr * c - r * s;
    const ty = dr * s + r * c;
    const length = Math.hypot(tx, ty) || 1;
    surface.push([r * c - (roller * ty) / length, r * s + (roller * tx) / length]);
  }
  return { pitch, surface };
}
