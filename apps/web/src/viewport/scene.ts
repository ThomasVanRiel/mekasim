import {
  type Bounds,
  type Cycle,
  centreOf,
  docFactor,
  GROUND,
  LENGTH,
  modelExtent,
  motionBounds,
  type PartSizes,
  type Point,
  partSizes,
  pinDiameters,
  plateOutline,
  pointMotion,
  type Simulation,
} from "@mekasim/core";
import { label } from "../names.ts";
import { BODY_COLORS } from "../theme.ts";

export type { Bounds };

/** Drawing sizes in metres: the real ones where the model gives them. */
export type Sizes = PartSizes;

export interface DrawPoint {
  name: string;
  u: number;
  v: number;
}

export interface DrawBody {
  id: string;
  /** Index into the solver coordinates; -1 for ground. */
  index: number;
  color: string;
  /** Back face of the plate. */
  z: number;
  outline: Point[];
  points: DrawPoint[];
}

export interface DrawPin {
  id: string;
  kind: "revolute" | "weld" | "slider" | "pin-slot";
  /** The points the joint connects, each as `body.point`. */
  refs: string[];
  /** Body the pin is drawn on, at `(u, v)` in its frame. */
  body: number;
  u: number;
  v: number;
  zBack: number;
  zFront: number;
  radius: number;
  driven: boolean;
}

export interface DrawAxis {
  id: string;
  body: number;
  from: Point;
  to: Point;
  z: number;
}

/** A gear or pulley: a circle on a body, with marks on its rim to show it turning. */
export interface DrawWheel {
  id: string;
  /** The gear or belt joint it belongs to. */
  joint: string;
  body: number;
  u: number;
  v: number;
  radius: number;
  z: number;
}

/** A place on a body, for things drawn between two bodies. */
export interface Anchor {
  body: number;
  u: number;
  v: number;
  /** Radius of the wheel there, for a belt. */
  radius: number;
}

/** A line between two bodies that is redrawn as they move: a fixed-distance tie, or a belt. */
export interface DrawTie {
  id: string;
  kind: "distance" | "belt";
  a: Anchor;
  b: Anchor;
  z: number;
}

/** A cam plate, as its working surface in the frame of the cam's body. */
export interface DrawCam {
  id: string;
  body: number;
  outline: Point[];
  z: number;
}

/** The roller of a cam follower. */
export interface DrawRoller {
  id: string;
  body: number;
  u: number;
  v: number;
  radius: number;
  z: number;
}

/** A measured distance, drawn as a line between the two places it is measured between. */
export interface DrawDimension {
  /** The measure it shows. */
  id: string;
  text: string;
  a: Omit<Anchor, "radius">;
  b: Omit<Anchor, "radius">;
}

export interface DrawTrace {
  ref: string;
  points: [number, number, number][];
}

/** A name written next to a point, or on a body. */
export interface DrawLabel {
  text: string;
  /** Whether it names a body rather than a point. */
  body: boolean;
  /** Body it moves with, and its place in that body's frame. */
  carrier: number;
  u: number;
  v: number;
  z: number;
}

export interface Scene {
  cycle: Cycle;
  /**
   * Positions of all bodies that replace the cycle while a part is being dragged.
   * Set and cleared by the drag itself, and read every frame.
   */
  override?: Float64Array;
  /** Whether the last sample leads back into the first, so playback can loop smoothly. */
  periodic: boolean;
  sizes: Sizes;
  /** Everything the mechanism reaches over the cycle. */
  bounds: Bounds;
  /** Front of the frontmost layer. */
  depth: number;
  /** Grid spacing in metres, a round number of document units. */
  gridStep: number;
  ground: DrawPoint[];
  /** Ground points that carry a pin, drawn as fixed supports. */
  supports: Point[];
  groundZ: number;
  bodies: DrawBody[];
  pins: DrawPin[];
  axes: DrawAxis[];
  wheels: DrawWheel[];
  ties: DrawTie[];
  cams: DrawCam[];
  rollers: DrawRoller[];
  traces: DrawTrace[];
  dimensions: DrawDimension[];
  labels: DrawLabel[];
}

function wrap(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}

/** Position `[x, y, angle]` of a body at a fractional sample index. */
export function poseAt(
  scene: Scene,
  body: number,
  step: number,
  out: [number, number, number],
): void {
  const { cycle, periodic, override } = scene;
  if (override) {
    out[0] = override[3 * body];
    out[1] = override[3 * body + 1];
    out[2] = override[3 * body + 2];
    return;
  }
  const k0 = Math.min(Math.max(Math.floor(step), 0), cycle.count - 1);
  const next = k0 + 1 < cycle.count ? k0 + 1 : periodic ? 0 : k0;
  const f = Math.min(Math.max(step - k0, 0), 1);
  const a = k0 * cycle.width + 3 * body;
  const b = next * cycle.width + 3 * body;
  const { q } = cycle;
  out[0] = q[a] + f * (q[b] - q[a]);
  out[1] = q[a + 1] + f * (q[b + 1] - q[a + 1]);
  // A crank's angle grows by a full turn per cycle, so take the short way round.
  out[2] = q[a + 2] + f * wrap(q[b + 2] - q[a + 2]);
}

function isPeriodic(cycle: Cycle, extent: number): boolean {
  if (cycle.count < 3 || cycle.failure) return false;
  const dt = cycle.t[1] - cycle.t[0];
  const last = (cycle.count - 1) * cycle.width;
  for (let i = 0; i < cycle.width; i++) {
    // One step beyond the last sample should land on the first.
    const predicted = cycle.q[last + i] + cycle.qd[last + i] * dt;
    const error = i % 3 === 2 ? wrap(predicted - cycle.q[i]) : (predicted - cycle.q[i]) / extent;
    if (Math.abs(error) > 0.01) return false;
  }
  return true;
}

/** Round to 1, 2 or 5 times a power of ten. */
function nice(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const lead = value / power;
  return (lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10) * power;
}

function split(ref: string): [string, string] {
  return ref.split(".") as [string, string];
}

export function buildScene(simulation: Simulation): Scene | undefined {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || cycle.count === 0) return undefined;

  const bounds = motionBounds(compiled, cycle);
  const unit = docFactor(LENGTH, compiled.units);
  const extent = modelExtent(compiled, bounds);
  const sizes = partSizes(compiled, extent);
  const { half } = sizes;
  // A pin is smaller where pins crowd, as on an eccentric with a small throw.
  const pinSizes = pinDiameters(compiled, 2 * sizes.pin);
  const radiusOf = (joint: string): number => (pinSizes.get(joint) ?? 2 * sizes.pin) / 2;
  const backOf = (layer: number): number => layer * sizes.pitch;

  const groundBody = compiled.bodies.get(GROUND);
  const groundZ = backOf(groundBody?.layer ?? 0);
  let depth = sizes.thickness;

  const bodies: DrawBody[] = [];
  for (const body of compiled.bodies.values()) {
    if (body.index < 0) continue;
    const points = [...body.points].map(([name, { u, v }]) => ({ name, u, v }));
    const z = backOf(body.layer);
    depth = Math.max(depth, z + sizes.thickness);
    bodies.push({
      id: body.id,
      index: body.index,
      color: BODY_COLORS[body.index % BODY_COLORS.length] as string,
      z,
      outline: plateOutline(
        points.map((p): Point => [p.u, p.v]),
        half,
      ),
      points,
    });
  }

  const locate = (ref: string) => {
    const [bodyId, name] = split(ref);
    const body = compiled.bodies.get(bodyId);
    const local = body?.points.get(name);
    if (!body || !local) throw new Error(`Unknown point "${ref}"`);
    return { index: body.index, z: backOf(body.layer), ...local };
  };

  const driven = new Set(compiled.drivers.map((driver) => driver.joint));
  const pins: DrawPin[] = [];
  const axes: DrawAxis[] = [];
  const supports: Point[] = [];
  const wheels: DrawWheel[] = [];
  const ties: DrawTie[] = [];
  const cams: DrawCam[] = [];
  const rollers: DrawRoller[] = [];
  const margin = sizes.thickness * 0.2;

  /** Where a located point is at the first sample. */
  const startOf = (p: { index: number; u: number; v: number }): Point => {
    if (p.index < 0) return [p.u, p.v];
    const at = 3 * p.index;
    const c = Math.cos(cycle.q[at + 2]);
    const s = Math.sin(cycle.q[at + 2]);
    return [cycle.q[at] + p.u * c - p.v * s, cycle.q[at + 1] + p.u * s + p.v * c];
  };
  const reach = (at: Point, radius: number): void => {
    bounds.minX = Math.min(bounds.minX, at[0] - radius);
    bounds.maxX = Math.max(bounds.maxX, at[0] + radius);
    bounds.minY = Math.min(bounds.minY, at[1] - radius);
    bounds.maxY = Math.max(bounds.maxY, at[1] + radius);
  };

  for (const joint of compiled.joints) {
    if (joint.type === "revolute" || joint.type === "weld") {
      const a = locate(joint.points[0] as string);
      const b = locate(joint.points[1] as string);
      // Draw the pin on a moving body so that it follows the motion.
      const carrier = a.index >= 0 ? a : b;
      if (a.index < 0 || b.index < 0) {
        const fixed = a.index < 0 ? a : b;
        // Several joints can share one ground point; it gets one support.
        if (!supports.some(([u, v]) => u === fixed.u && v === fixed.v)) {
          supports.push([fixed.u, fixed.v]);
        }
      }
      pins.push({
        id: joint.id,
        kind: joint.type,
        refs: joint.points,
        body: carrier.index,
        u: carrier.u,
        v: carrier.v,
        zBack: Math.min(a.z, b.z) - margin,
        zFront: Math.max(a.z, b.z) + sizes.thickness + margin,
        radius: radiusOf(joint.id),
        driven: driven.has(joint.id),
      });
      continue;
    }

    if (joint.type === "distance" || joint.type === "gear" || joint.type === "belt") {
      const a = locate(joint.points[0] as string);
      const b = locate(joint.points[1] as string);
      const front = Math.max(a.z, b.z) + sizes.thickness + margin;
      const radii: [number, number] = [0, 0];
      if (joint.detail?.kind === "wheels") {
        // Meshing gears touch between their centres; pulleys are drawn to scale with room between.
        const [ax, ay] = startOf(a);
        const [bx, by] = startOf(b);
        const [first, second] = joint.detail.sizes;
        const span = Math.hypot(bx - ax, by - ay) * (joint.type === "gear" ? 1 : 0.6);
        radii[0] = (span * first) / (first + second);
        radii[1] = (span * second) / (first + second);
        [a, b].forEach((wheel, i) => {
          const radius = radii[i] as number;
          wheels.push({
            id: `${joint.id}/${i}`,
            joint: joint.id,
            body: wheel.index,
            u: wheel.u,
            v: wheel.v,
            radius,
            z: wheel.z + sizes.thickness + margin,
          });
          reach(startOf(wheel), radius);
        });
      }
      if (joint.type !== "gear") {
        ties.push({
          id: joint.id,
          kind: joint.type,
          a: { body: a.index, u: a.u, v: a.v, radius: radii[0] },
          b: { body: b.index, u: b.u, v: b.v, radius: radii[1] },
          z: front,
        });
      }
      continue;
    }

    if (joint.type === "cam") {
      const centre = locate(joint.points[0] as string);
      const follower = locate(joint.points[1] as string);
      if (joint.detail?.kind === "cam") {
        const { surface, pitch, roller } = joint.detail;
        cams.push({
          id: joint.id,
          body: centre.index,
          outline: surface.map(([x, y]): Point => [centre.u + x, centre.v + y]),
          z: centre.z,
        });
        rollers.push({
          id: joint.id,
          body: follower.index,
          u: follower.u,
          v: follower.v,
          radius: roller,
          z: follower.z + sizes.thickness + margin,
        });
        reach(startOf(centre), Math.max(...pitch.map(([x, y]) => Math.hypot(x, y))) + roller);
      }
      continue;
    }

    const from = locate(joint.points[0] as string);
    const to = locate(joint.points[1] as string);
    const pin = locate(joint.points[2] as string);
    pins.push({
      id: joint.id,
      kind: joint.type,
      refs: joint.points,
      body: pin.index,
      u: pin.u,
      v: pin.v,
      zBack: Math.min(from.z, pin.z) - margin,
      zFront: Math.max(from.z, pin.z) + sizes.thickness + margin,
      radius: radiusOf(joint.id),
      driven: false,
    });

    // Draw the axis as far as the pin travels along it.
    const length = Math.hypot(to.u - from.u, to.v - from.v);
    const dx = (to.u - from.u) / length;
    const dy = (to.v - from.v) / length;
    const motion = pointMotion(compiled, cycle, joint.points[2] as string);
    let low = 0;
    let high = length;
    for (let k = 0; k < cycle.count; k++) {
      let x = motion.x[k];
      let y = motion.y[k];
      if (from.index >= 0) {
        // Bring the pin into the frame of the axis body.
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
    low -= 3 * half;
    high += 3 * half;
    axes.push({
      id: joint.id,
      body: from.index,
      from: [from.u + low * dx, from.v + low * dy],
      to: [from.u + high * dx, from.v + high * dy],
      z: Math.max(from.z, pin.z) + sizes.thickness + margin,
    });
  }

  const traces = compiled.traces.map((ref): DrawTrace => {
    const motion = pointMotion(compiled, cycle, ref);
    const z = locate(ref).z + sizes.thickness + margin;
    const points: [number, number, number][] = [];
    for (let k = 0; k < cycle.count; k++) points.push([motion.x[k], motion.y[k], z]);
    return { ref, points };
  });

  // A measure that is the distance between two places is drawn where it is measured.
  const dimensions: DrawDimension[] = [];
  const anchorOf = (ref: string): DrawDimension["a"] | undefined => {
    const [bodyId, name] = ref.split(".");
    const body = compiled.bodies.get(bodyId as string);
    // A link on its own stands for its centre, as it does in the measure.
    const local = body && (name === undefined ? centreOf(body) : body.points.get(name));
    return body && local ? { body: body.index, u: local.u, v: local.v } : undefined;
  };
  for (const { id, ast } of compiled.measures) {
    if (ast.kind !== "call" || ast.name !== "dist" || ast.args.length !== 2) continue;
    const [a, b] = ast.args.map((arg) => (arg.kind === "ref" ? anchorOf(arg.name) : undefined));
    if (a && b) dimensions.push({ id, text: label(id), a, b });
  }

  // Two points pinned together need one name, not two on top of each other. The
  // ground's name is kept, since ground points are what a reader looks up first.
  const unnamed = new Set<string>();
  for (const joint of compiled.joints) {
    if (joint.type !== "revolute" && joint.type !== "weld") continue;
    const [a, b] = joint.points as [string, string];
    unnamed.add(split(b)[0] === GROUND ? a : b);
  }
  const labels: DrawLabel[] = [];
  for (const body of compiled.bodies.values()) {
    const front = backOf(body.layer) + (body.index < 0 ? 0 : sizes.thickness);
    let cu = 0;
    let cv = 0;
    for (const [name, { u, v }] of body.points) {
      cu += u / body.points.size;
      cv += v / body.points.size;
      if (unnamed.has(`${body.id}.${name}`)) continue;
      labels.push({ text: label(name), body: false, carrier: body.index, u, v, z: front });
    }
    if (body.index >= 0 && body.points.size > 1) {
      labels.push({
        text: label(body.id),
        body: true,
        carrier: body.index,
        u: cu,
        v: cv,
        z: front,
      });
    }
  }

  const periodic = isPeriodic(cycle, extent);
  for (const trace of traces) {
    if (periodic && trace.points.length > 0) {
      trace.points.push(trace.points[0] as [number, number, number]);
    }
  }

  return {
    cycle,
    periodic,
    sizes,
    bounds,
    depth,
    gridStep: nice((extent / unit / 14) * 1) * unit,
    ground: groundBody ? [...groundBody.points].map(([name, { u, v }]) => ({ name, u, v })) : [],
    supports,
    groundZ,
    bodies,
    pins,
    axes,
    wheels,
    ties,
    cams,
    rollers,
    traces,
    dimensions,
    labels,
  };
}
