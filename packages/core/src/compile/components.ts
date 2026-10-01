import type { Diagnostic } from "../diagnostics.ts";
import { type Document, type Expr, GROUND } from "../schema/document.ts";

type Path = (string | number)[];

/**
 * A body whose starting position is worked out from what it is attached to,
 * instead of being given in `pose`.
 */
export type AutoPose =
  /** A rod: one end on `from`, pointing at `to`. */
  | { body: string; from: string; to: string }
  /** A crank mounted on a moving point. */
  | { body: string; at: string; angle: Expr };

export interface Expansion {
  /** The document with its components replaced by the bodies, joints and drivers they stand for. */
  doc: Document;
  autoPoses: AutoPose[];
  /** Where generated entries come from, so that a problem in one is reported on its component. */
  origins: { prefix: Path; to: Path }[];
  diagnostics: Diagnostic[];
}

function text(value: Expr): string {
  return typeof value === "number" ? String(value) : `(${value})`;
}

/**
 * Replace components by primitives. A component is a short way of writing a common
 * part: nothing reaches the solver that could not have been written out by hand.
 */
export function expandComponents(source: Document): Expansion {
  const diagnostics: Diagnostic[] = [];
  const origins: Expansion["origins"] = [];
  const autoPoses: AutoPose[] = [];
  if (!source.components) return { doc: source, autoPoses, origins, diagnostics };

  const bodies: Document["bodies"] = { ...source.bodies };
  const joints: NonNullable<Document["joints"]> = { ...source.joints };
  const drivers: NonNullable<Document["drivers"]> = { ...source.drivers };
  const pose: NonNullable<Document["pose"]> = { ...source.pose };

  for (const [id, component] of Object.entries(source.components)) {
    const path: Path = ["components", id];
    const problems: string[] = [];
    const claim = (taken: boolean, what: string): void => {
      if (taken) problems.push(`${what} already exists; rename it or the component`);
    };
    claim(id in bodies, `A body named "${id}"`);

    if (component.type === "crank") {
      const fixed = typeof component.at !== "string";
      if ("O" in component.arms)
        problems.push('"O" is the pivot of a crank and cannot name an arm');
      claim(id in joints, `A joint named "${id}"`);
      claim(component.speed !== undefined && id in drivers, `A driver named "${id}"`);
      claim(fixed && id in (bodies[GROUND]?.points ?? {}), `A ground point named "${id}"`);
      if (problems.length === 0) {
        const points: Document["bodies"][string]["points"] = { O: [0, 0] };
        for (const [name, [radius, angle]] of Object.entries(component.arms)) {
          // The arm's end, from its radius and angle.
          points[name] = [
            `${text(radius)} * cos(${String(angle)})`,
            `${text(radius)} * sin(${String(angle)})`,
          ];
        }
        bodies[id] = { points, layer: component.layer };
        const angle = component.angle ?? 0;
        if (typeof component.at === "string") {
          joints[id] = { type: "revolute", connect: [component.at, `${id}.O`] };
          if (!(id in pose)) autoPoses.push({ body: id, at: component.at, angle });
        } else {
          const ground = bodies[GROUND] ?? { points: {} };
          bodies[GROUND] = { ...ground, points: { ...ground.points, [id]: component.at } };
          joints[id] = { type: "revolute", connect: [`${GROUND}.${id}`, `${id}.O`] };
          if (!(id in pose)) pose[id] = [component.at[0], component.at[1], angle];
          origins.push({ prefix: ["bodies", GROUND, "points", id], to: path });
        }
        if (component.speed !== undefined) {
          drivers[id] = { joint: id, speed: component.speed, phase: angle };
          origins.push({ prefix: ["drivers", id], to: path });
        }
        origins.push({ prefix: ["joints", id], to: path });
      }
    } else {
      const ends = [`${id}_a`, `${id}_b`] as const;
      for (const joint of ends) claim(joint in joints, `A joint named "${joint}"`);
      for (const name of ["A", "B"]) {
        if (name in (component.points ?? {})) {
          problems.push(`"${name}" is an end of the rod and cannot name another point`);
        }
      }
      if (problems.length === 0) {
        bodies[id] = {
          points: { A: [0, 0], B: [component.length, 0], ...component.points },
          layer: component.layer,
        };
        joints[ends[0]] = { type: "revolute", connect: [component.connect[0], `${id}.A`] };
        joints[ends[1]] = { type: "revolute", connect: [component.connect[1], `${id}.B`] };
        if (!(id in pose)) {
          autoPoses.push({ body: id, from: component.connect[0], to: component.connect[1] });
        }
        for (const joint of ends) origins.push({ prefix: ["joints", joint], to: path });
      }
    }

    origins.push({ prefix: ["bodies", id], to: path }, { prefix: ["pose", id], to: path });
    for (const message of problems) diagnostics.push({ severity: "error", message, path });
  }

  return { doc: { ...source, bodies, joints, drivers, pose }, autoPoses, origins, diagnostics };
}
