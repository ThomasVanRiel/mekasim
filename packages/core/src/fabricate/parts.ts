import { pointMotion } from "../analysis/measures.ts";
import { type Point, plateOutline } from "../geometry/outline.ts";
import { GROUND } from "../schema/document.ts";
import type { Simulation } from "../simulate.ts";

/** The real dimensions parts are made to, in metres. */
export interface Fabrication {
  /** Width of a link. */
  width: number;
  /** Thickness of the sheet or print. */
  thickness: number;
  /** Diameter of the pins. */
  hole: number;
  /** Added to the hole diameter, so that a pin turns freely. */
  clearance: number;
}

export interface Hole {
  x: number;
  y: number;
  diameter: number;
}

/** A straight slot with round ends, for a pin that travels. */
export interface Slot {
  from: Point;
  to: Point;
  width: number;
}

/** One piece to cut or print, flat, in metres. */
export interface Part {
  /** The body or cam it is, as named in the model. */
  id: string;
  outline: Point[];
  holes: Hole[];
  slots: Slot[];
}

/** Corners per full turn of the rounded outlines. */
const SMOOTH = 96;

/**
 * The parts of a mechanism as flat pieces: every moving body as a plate round its
 * points with a hole at each pinned point, a slot where a pin travels, each cam as
 * its own plate, and the ground as a base plate carrying the fixed pivots.
 */
export function buildParts(simulation: Simulation, fabrication: Fabrication): Part[] {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || cycle.count === 0) return [];
  const bore = fabrication.hole + fabrication.clearance;

  const holes = new Map<string, Map<string, Hole>>();
  const slots = new Map<string, Slot[]>();
  const local = (ref: string) => {
    const [bodyId, name] = ref.split(".") as [string, string];
    const body = compiled.bodies.get(bodyId);
    const at = body?.points.get(name);
    if (!body || !at) throw new Error(`Unknown point "${ref}"`);
    return { bodyId, name, index: body.index, ...at };
  };
  const drill = (ref: string): void => {
    const p = local(ref);
    const ofBody = holes.get(p.bodyId) ?? new Map<string, Hole>();
    ofBody.set(p.name, { x: p.u, y: p.v, diameter: bore });
    holes.set(p.bodyId, ofBody);
  };

  const cams: Part[] = [];
  for (const joint of compiled.joints) {
    if (joint.type === "revolute" || joint.type === "weld") {
      for (const ref of joint.points) drill(ref);
    } else if (joint.type === "slider" || joint.type === "pin-slot") {
      const [fromRef, toRef, pinRef] = joint.points as [string, string, string];
      drill(pinRef);
      // The slot covers the travel of the pin along the axis, seen from the axis's body.
      const from = local(fromRef);
      const to = local(toRef);
      const length = Math.hypot(to.u - from.u, to.v - from.v);
      const dx = (to.u - from.u) / length;
      const dy = (to.v - from.v) / length;
      const motion = pointMotion(compiled, cycle, pinRef);
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < cycle.count; k++) {
        let x = motion.x[k];
        let y = motion.y[k];
        if (from.index >= 0) {
          const at = k * cycle.width + 3 * from.index;
          const c = Math.cos(cycle.q[at + 2]);
          const s = Math.sin(cycle.q[at + 2]);
          const rx = x - cycle.q[at];
          const ry = y - cycle.q[at + 1];
          x = rx * c + ry * s;
          y = -rx * s + ry * c;
        }
        const along = (x - from.u) * dx + (y - from.v) * dy;
        low = Math.min(low, along);
        high = Math.max(high, along);
      }
      const ofBody = slots.get(from.bodyId) ?? [];
      ofBody.push({
        from: [from.u + low * dx, from.v + low * dy],
        to: [from.u + high * dx, from.v + high * dy],
        width: bore,
      });
      slots.set(from.bodyId, ofBody);
    } else if (joint.type === "cam" && joint.detail?.kind === "cam") {
      // A cam is cut as a plate of its own, bored at its centre to go on the cam's shaft.
      cams.push({
        id: joint.id,
        outline: joint.detail.surface,
        holes: [{ x: 0, y: 0, diameter: bore }],
        slots: [],
      });
    }
  }

  const parts: Part[] = [];
  for (const body of compiled.bodies.values()) {
    const bodyHoles = [...(holes.get(body.id)?.values() ?? [])];
    const bodySlots = slots.get(body.id) ?? [];
    const reach: Point[] = bodySlots.flatMap((slot) => [slot.from, slot.to]);
    let points: Point[];
    let margin = fabrication.width / 2;
    if (body.id === GROUND) {
      // The base plate needs only the points something is fixed to, with more material round them.
      points = [...bodyHoles.map((hole): Point => [hole.x, hole.y]), ...reach];
      margin = fabrication.width;
    } else {
      points = [...[...body.points.values()].map(({ u, v }): Point => [u, v]), ...reach];
    }
    if (points.length === 0) continue;
    parts.push({
      id: body.id,
      outline: plateOutline(points, margin, SMOOTH),
      holes: bodyHoles,
      slots: bodySlots,
    });
  }
  // The base plate first, then the links in the order of the model, then the cams.
  parts.sort((a, b) => Number(b.id === GROUND) - Number(a.id === GROUND));
  return [...parts, ...cams];
}

/** The outline of a slot, as a closed polygon. */
export function slotOutline(slot: Slot): Point[] {
  return plateOutline([slot.from, slot.to], slot.width / 2, SMOOTH);
}

/** Reasons the dimensions cannot be made, for showing before anything is exported. */
export function checkFabrication(fabrication: Fabrication): string[] {
  const problems: string[] = [];
  if (!(fabrication.width > 0)) problems.push("The link width must be more than zero.");
  if (!(fabrication.thickness > 0)) problems.push("The thickness must be more than zero.");
  if (!(fabrication.hole > 0)) problems.push("The hole diameter must be more than zero.");
  if (fabrication.clearance < 0) problems.push("The clearance cannot be negative.");
  if (fabrication.hole + fabrication.clearance >= fabrication.width) {
    problems.push("The holes are as wide as the links. Make the links wider or the holes smaller.");
  }
  return problems;
}

function turn(p: Point, c: number, s: number, dx: number, dy: number): Point {
  return [p[0] * c - p[1] * s + dx, p[0] * s + p[1] * c + dy];
}

/**
 * Arrange parts for one sheet: each turned to lie lengthwise, stacked one above the
 * other with `gap` between, the first at the origin.
 */
export function layoutParts(parts: Part[], gap: number): Part[] {
  let top = 0;
  return parts.map((part) => {
    // The two outline points furthest apart give the direction the part is longest in.
    let far = 0;
    let angle = 0;
    for (const a of part.outline) {
      for (const b of part.outline) {
        const d = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        if (d > far) {
          far = d;
          angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        }
      }
    }
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const turned = part.outline.map((p) => turn(p, c, s, 0, 0));
    const minX = Math.min(...turned.map((p) => p[0]));
    const minY = Math.min(...turned.map((p) => p[1]));
    const maxY = Math.max(...turned.map((p) => p[1]));
    const dx = -minX;
    const dy = top - minY;
    top += maxY - minY + gap;
    return {
      id: part.id,
      outline: part.outline.map((p) => turn(p, c, s, dx, dy)),
      holes: part.holes.map((hole) => {
        const [x, y] = turn([hole.x, hole.y], c, s, dx, dy);
        return { x, y, diameter: hole.diameter };
      }),
      slots: part.slots.map((slot) => ({
        from: turn(slot.from, c, s, dx, dy),
        to: turn(slot.to, c, s, dx, dy),
        width: slot.width,
      })),
    };
  });
}
