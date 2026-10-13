/**
 * Exponents of length, time, mass and angle. Values are held in SI (m, s, kg, rad);
 * the dimension says what a number means and how to show it.
 */
export type Dim = readonly [length: number, time: number, mass: number, angle: number];

export const NONE: Dim = [0, 0, 0, 0];
export const LENGTH: Dim = [1, 0, 0, 0];
export const TIME: Dim = [0, 1, 0, 0];
export const MASS: Dim = [0, 0, 1, 0];
export const ANGLE: Dim = [0, 0, 0, 1];
export const ANGULAR_SPEED: Dim = [0, -1, 0, 1];

export interface UnitDef {
  dim: Dim;
  /** SI value of one unit. */
  factor: number;
}

export const UNITS: Record<string, UnitDef> = {
  mm: { dim: LENGTH, factor: 1e-3 },
  cm: { dim: LENGTH, factor: 1e-2 },
  m: { dim: LENGTH, factor: 1 },
  in: { dim: LENGTH, factor: 0.0254 },
  deg: { dim: ANGLE, factor: Math.PI / 180 },
  rad: { dim: ANGLE, factor: 1 },
  rev: { dim: ANGLE, factor: 2 * Math.PI },
  s: { dim: TIME, factor: 1 },
  ms: { dim: TIME, factor: 1e-3 },
  kg: { dim: MASS, factor: 1 },
  g: { dim: MASS, factor: 1e-3 },
  rpm: { dim: ANGULAR_SPEED, factor: (2 * Math.PI) / 60 },
  "rad/s": { dim: ANGULAR_SPEED, factor: 1 },
  "deg/s": { dim: ANGULAR_SPEED, factor: Math.PI / 180 },
  Hz: { dim: ANGULAR_SPEED, factor: 2 * Math.PI },
};

export const LENGTH_UNITS = ["mm", "cm", "m", "in"] as const;
export const ANGLE_UNITS = ["deg", "rad"] as const;

/** The units a document reads bare numbers in and shows results in. */
export interface Units {
  length: (typeof LENGTH_UNITS)[number];
  angle: (typeof ANGLE_UNITS)[number];
}

export const DEFAULT_UNITS: Units = { length: "mm", angle: "deg" };

export function isPure(dim: Dim): boolean {
  return dim.every((e) => e === 0);
}

/**
 * Radians are dimensionless once combined with a length or a mass: `omega * r` is a
 * speed and `omega ^ 2 * r` an acceleration. Angle is only kept as a dimension on
 * its own or with time.
 */
function dropMixedAngle(dim: Dim): Dim {
  return dim[3] !== 0 && !angleCounts(dim) ? [dim[0], dim[1], dim[2], 0] : dim;
}

export function dimMul(a: Dim, b: Dim): Dim {
  return dropMixedAngle([a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]);
}

export function dimDiv(a: Dim, b: Dim): Dim {
  return dropMixedAngle([a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]]);
}

export function dimPow(a: Dim, p: number): Dim {
  return [a[0] * p, a[1] * p, a[2] * p, a[3] * p];
}

/** Whether two quantities can be added or compared. */
export function compatible(a: Dim, b: Dim): boolean {
  return a.every((e, i) => e === b[i]);
}

/** Whether the angle exponent of a dimension means anything; see `dropMixedAngle`. */
function angleCounts(dim: Dim): boolean {
  return dim[0] === 0 && dim[2] === 0;
}

/** SI value of one document unit of the given dimension, e.g. 0.001 for a length in mm. */
export function docFactor(dim: Dim, units: Units): number {
  let factor = (UNITS[units.length] as UnitDef).factor ** dim[0];
  if (angleCounts(dim)) factor *= (UNITS[units.angle] as UnitDef).factor ** dim[3];
  return factor;
}

const SUPERSCRIPT: Record<string, string> = { "2": "²", "3": "³" };

function power(unit: string, exponent: number): string {
  if (exponent === 1) return unit;
  return unit + (SUPERSCRIPT[String(exponent)] ?? `^${exponent}`);
}

/** Label of the document unit for a dimension, e.g. `mm/s²`. Empty for plain numbers. */
export function unitLabel(dim: Dim, units: Units): string {
  const parts: [string, number][] = [
    [units.length, dim[0]],
    ["kg", dim[2]],
    [units.angle, angleCounts(dim) ? dim[3] : 0],
    ["s", dim[1]],
  ];
  const top = parts.filter(([, e]) => e > 0).map(([u, e]) => power(u, e));
  const bottom = parts.filter(([, e]) => e < 0).map(([u, e]) => power(u, -e));
  if (bottom.length === 0) return top.join("·");
  return `${top.join("·") || "1"}/${bottom.join("/")}`;
}

/** Convert an SI value to document units and append the unit label. */
export function formatQuantity(value: number, dim: Dim, units: Units, digits = 6): string {
  const shown = value / docFactor(dim, units);
  const text = Number(shown.toPrecision(digits)).toString();
  const label = unitLabel(dim, units);
  return label ? `${text} ${label}` : text;
}

const NAMED: [Dim, string][] = [
  [NONE, "a plain number"],
  [LENGTH, "a length"],
  [ANGLE, "an angle"],
  [TIME, "a time"],
  [MASS, "a mass"],
  [ANGULAR_SPEED, "an angular speed"],
];

/** Dimension in words, for error messages. */
export function describeDim(dim: Dim): string {
  const named = NAMED.find(([d]) => d.every((e, i) => e === dim[i]));
  if (named) return named[1];
  return `a quantity in ${unitLabel(dim, { length: "m", angle: "rad" })}`;
}
