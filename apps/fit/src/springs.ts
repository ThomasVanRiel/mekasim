import { ANGLE, docFactor, formatQuantity, LENGTH, type Units, unitLabel } from "@mekasim/core";
import { type FitSimulation, FORCE, shownUnit, TORQUE } from "@mekasim/fit";

/** One line of the Springs and locks fold: what a thing is, and how it stands at the shown step. */
export interface HoldRow {
  key: string;
  name: string;
  /** What it is, from the model. */
  about: string;
  /** How it stands at the step being shown. */
  now: string;
}

/** What the fold lists, in the order of the model. */
export interface Holds {
  springs: HoldRow[];
  stops: HoldRow[];
  locks: HoldRow[];
}

function brief(value: number, digits = 3): string {
  return Number(value.toPrecision(digits)).toString();
}

/** A force or a torque in the unit mekafit shows it in. */
export function loadText(value: number, torque: boolean, units: Units): string {
  const unit = shownUnit(torque ? TORQUE : FORCE, units) as { label: string; factor: number };
  return `${brief(value / unit.factor)} ${unit.label}`;
}

/** A stiffness as it would be written in the model: per millimetre or per degree where the model uses those. */
function stiffnessText(value: number, torsion: boolean, units: Units): string {
  if (!torsion) {
    return units.length === "mm" ? `${brief(value / 1000)} N/mm` : `${brief(value)} N/m`;
  }
  const torque = shownUnit(TORQUE, units) as { label: string; factor: number };
  const angle = docFactor(ANGLE, units);
  return `${brief((value / torque.factor) * angle)} ${torque.label}/${unitLabel(ANGLE, units)}`;
}

/** The springs, stops and locks of a run, each with how it stands at one step. */
export function holdsAt(simulation: FitSimulation | undefined, step: number): Holds {
  const compiled = simulation?.compiled;
  const count = simulation?.cycle?.count ?? 0;
  if (!compiled || count === 0) return { springs: [], stops: [], locks: [] };
  const { units } = compiled;
  const k = Math.min(count - 1, Math.max(0, Math.round(step)));
  const { loads, latched } = simulation;
  const size = (value: number, angle: boolean): string =>
    formatQuantity(value, angle ? ANGLE : LENGTH, units, 4);

  const springs = compiled.springs.map((spring): HoldRow => {
    const load = loads?.springs[spring.id]?.[k] ?? 0;
    const torsion = spring.kind === "torsion";
    const stiffness = stiffnessText(spring.stiffness, torsion, units);
    return {
      key: `spring ${spring.id}`,
      name: spring.id,
      about: torsion
        ? `${stiffness} on ${spring.joint}, at rest at ${size(spring.rest, true)}`
        : `${stiffness}, ${size(Math.max(spring.rest, 0), false)} long at rest`,
      now:
        Math.abs(load) < 1e-12
          ? "At rest"
          : torsion
            ? `Turning with ${loadText(Math.abs(load), true, units)}`
            : `${load > 0 ? "Pulling" : "Pushing"} with ${loadText(Math.abs(load), false, units)}`,
    };
  });

  const stops = compiled.stops.map((stop): HoldRow => {
    const angle = stop.value.kind === "angle";
    const load = loads?.stops[stop.joint]?.[k] ?? 0;
    const { low, high } = stop;
    return {
      key: `stop ${stop.joint}`,
      name: stop.joint,
      about:
        low !== undefined && high !== undefined
          ? `Between ${size(low, angle)} and ${size(high, angle)}`
          : low !== undefined
            ? `No less than ${size(low, angle)}`
            : high !== undefined
              ? `No more than ${size(high, angle)}`
              : "No stops",
      now:
        load > 0 ? `Against its stop with ${loadText(load, angle, units)}` : "Clear of its stops",
    };
  });

  const locks = compiled.locks.map((lock): HoldRow => {
    const angle = lock.value.kind === "angle";
    const isIn = (latched[lock.id]?.[k] ?? (lock.engaged ? 1 : 0)) === 1;
    const load = loads?.locks[lock.id]?.[k] ?? 0;
    return {
      key: `lock ${lock.id}`,
      name: lock.id,
      about: `Drops in behind ${lock.joint} at ${size(lock.at, angle)}`,
      now: !isIn ? "Out" : load > 0 ? `In, holding ${loadText(load, angle, units)}` : "In",
    };
  });

  return { springs, stops, locks };
}

/** Each lock with the joint it is on and whether it is in at a step, for its marker on the sheet. */
export function locksAt(
  simulation: FitSimulation | undefined,
  step: number,
): { id: string; joint: string; in: boolean }[] {
  const count = simulation?.cycle?.count ?? 0;
  if (!simulation?.compiled || count === 0) return [];
  const k = Math.min(count - 1, Math.max(0, Math.round(step)));
  return simulation.compiled.locks.map((lock) => ({
    id: lock.id,
    joint: lock.joint,
    in: (simulation.latched[lock.id]?.[k] ?? (lock.engaged ? 1 : 0)) === 1,
  }));
}
