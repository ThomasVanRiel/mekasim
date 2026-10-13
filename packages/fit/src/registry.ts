import type { Dim, Registry, UnitDef, Units } from "@mekasim/core";
import { FIT_FUNCTIONS } from "./measures.ts";

/** Force and the derived quantities used by springs and contact results. */
export const FORCE: Dim = [1, -2, 1, 0];
export const TORQUE: Dim = [2, -2, 1, 0];
export const LINEAR_STIFFNESS: Dim = [0, -2, 1, 0];

/** Radians are dimensionless in a torque, as they are elsewhere in core's expressions. */
export const TORSIONAL_STIFFNESS: Dim = TORQUE;

const MM = 1e-3;
const DEG = Math.PI / 180;

export const FORCE_UNITS: Record<string, UnitDef> = {
  N: { dim: FORCE, factor: 1 },
  "N*m": { dim: TORQUE, factor: 1 },
  "N*mm": { dim: TORQUE, factor: MM },
  "N/mm": { dim: LINEAR_STIFFNESS, factor: 1 / MM },
  "N*m/rad": { dim: TORSIONAL_STIFFNESS, factor: 1 },
  "N*mm/deg": { dim: TORSIONAL_STIFFNESS, factor: MM / DEG },
};

/** The units and the measure functions added only while mekafit runs a model. */
export const FIT_REGISTRY: Registry = { units: FORCE_UNITS, functions: FIT_FUNCTIONS };

function same(a: Dim, b: Dim): boolean {
  return a.every((exponent, i) => exponent === b[i]);
}

/**
 * The unit a force or a torque is shown in, with the SI value of one of it: newtons,
 * and newton millimetres in a model drawn in millimetres, newton metres in any
 * other. Nothing for a quantity that the document's own units show.
 */
export function shownUnit(dim: Dim, units: Units): { label: string; factor: number } | undefined {
  if (same(dim, FORCE)) return { label: "N", factor: 1 };
  if (same(dim, TORQUE))
    return units.length === "mm" ? { label: "N·mm", factor: MM } : { label: "N·m", factor: 1 };
  return undefined;
}
