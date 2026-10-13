import type { Dim, Registry, UnitDef } from "@mekasim/core";

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

/** Units and, in later steps, measure functions added only while mekafit runs a model. */
export const FIT_REGISTRY: Registry = { units: FORCE_UNITS };
