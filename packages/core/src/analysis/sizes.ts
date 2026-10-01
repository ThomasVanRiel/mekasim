import type { Compiled } from "../compile/compile.ts";
import { docFactor, LENGTH } from "../expr/units.ts";
import type { Cycle } from "./cycle.ts";
import { pointMotion } from "./measures.ts";

/** A box round everything the mechanism reaches over the cycle, in metres. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The sizes parts are drawn and made with, in metres. */
export interface PartSizes {
  /** Half the width of a link. */
  half: number;
  /** Thickness of a plate. */
  thickness: number;
  /** Distance from one layer to the next. */
  pitch: number;
  /** Radius of a pin, where there is room for it. */
  pin: number;
}

/** Everything the mechanism reaches over the cycle. An empty model gets a sheet to start on. */
export function motionBounds(compiled: Compiled, cycle: Cycle): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const body of compiled.bodies.values()) {
    for (const name of body.points.keys()) {
      const motion = pointMotion(compiled, cycle, `${body.id}.${name}`);
      for (let k = 0; k < cycle.count; k++) {
        bounds.minX = Math.min(bounds.minX, motion.x[k]);
        bounds.maxX = Math.max(bounds.maxX, motion.x[k]);
        bounds.minY = Math.min(bounds.minY, motion.y[k]);
        bounds.maxY = Math.max(bounds.maxY, motion.y[k]);
      }
    }
  }
  if (!Number.isFinite(bounds.minX)) {
    const unit = docFactor(LENGTH, compiled.units);
    return { minX: -150 * unit, maxX: 150 * unit, minY: -100 * unit, maxY: 100 * unit };
  }
  return bounds;
}

/** The longer side of the bounds, but not less than suits a sheet of about 100 units. */
export function modelExtent(compiled: Compiled, bounds: Bounds): number {
  const unit = docFactor(LENGTH, compiled.units);
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 100 * unit);
}

/**
 * The sizes of the parts: the real dimensions where the model gives them, and
 * otherwise sizes that suit the model at the scale it is looked at.
 */
export function partSizes(compiled: Compiled, extent: number): PartSizes {
  const made = compiled.fabrication;
  const half = made.width === undefined ? extent * 0.013 : made.width / 2;
  const thickness = made.thickness ?? half * 1.2;
  return {
    half,
    thickness,
    pitch: made.thickness === undefined ? half * 1.9 : thickness * 1.5,
    pin: made.hole === undefined ? half * 0.42 : made.hole / 2,
  };
}

/** A pin takes at most this share of the distance to the nearest other pin on the same body. */
const PIN_SHARE = 0.8;

/**
 * The diameter of the pin of each joint. A pin is the size asked for unless another
 * pinned point of one of its bodies is too near for two pins of that size to fit
 * side by side, as on an eccentric with a small throw; then it is made smaller.
 */
export function pinDiameters(compiled: Compiled, nominal: number): Map<string, number> {
  // The pinned points of each body, in its own frame.
  const pinned = new Map<string, Map<string, { u: number; v: number }>>();
  const pinOf = (ref: string): void => {
    const [bodyId, name] = ref.split(".") as [string, string];
    const at = compiled.bodies.get(bodyId)?.points.get(name);
    if (!at) return;
    const points = pinned.get(bodyId) ?? new Map<string, { u: number; v: number }>();
    points.set(name, at);
    pinned.set(bodyId, points);
  };
  const jointPins = new Map<string, string[]>();
  for (const joint of compiled.joints) {
    if (joint.type === "revolute" || joint.type === "weld") jointPins.set(joint.id, joint.points);
    else if (joint.type === "slider" || joint.type === "pin-slot") {
      jointPins.set(joint.id, [joint.points[2] as string]);
    }
  }
  for (const refs of jointPins.values()) for (const ref of refs) pinOf(ref);

  const diameters = new Map<string, number>();
  for (const [id, refs] of jointPins) {
    let room = Number.POSITIVE_INFINITY;
    for (const ref of refs) {
      const [bodyId, name] = ref.split(".") as [string, string];
      const points = pinned.get(bodyId);
      const at = points?.get(name);
      if (!points || !at) continue;
      for (const [other, place] of points) {
        if (other === name) continue;
        const gap = Math.hypot(place.u - at.u, place.v - at.v);
        // Points at one place are one pin, not two that are in each other's way.
        if (gap > 1e-9) room = Math.min(room, gap);
      }
    }
    diameters.set(id, Math.min(nominal, room * PIN_SHARE));
  }
  return diameters;
}
