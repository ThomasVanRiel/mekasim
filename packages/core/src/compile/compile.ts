import type { Diagnostic } from "../diagnostics.ts";
import { type EvalContext, evaluate, type Quantity, toSI } from "../expr/evaluate.ts";
import { ExprError, KEYWORDS, type Node, parseExpr } from "../expr/parse.ts";
import {
  ANGLE,
  ANGULAR_SPEED,
  compatible,
  DEFAULT_UNITS,
  type Dim,
  docFactor,
  formatQuantity,
  LENGTH,
  NONE,
  type Units,
} from "../expr/units.ts";
import type { Fabrication } from "../fabricate/parts.ts";
import { OutlineError, parsePath } from "../geometry/path.ts";
import { circleLoop, type Loop, placeShape, type Shape } from "../geometry/shape.ts";
import { shapeOf } from "../geometry/validate.ts";
import type { Registry } from "../registry.ts";
import { type Document, type Expr, GROUND, type Joint, paramValue } from "../schema/document.ts";
import { camOutlines, camProfile } from "../solver/cam.ts";
import {
  angleCoupling,
  type BodyPoint,
  type Constraint,
  camContact,
  coincident,
  distance,
  GROUND_INDEX,
  pointOnLine,
  relativeAngle,
} from "../solver/constraints.ts";
import type { SolverModel } from "../solver/solve.ts";
import {
  cross,
  cylindrical,
  dot,
  hingeAngle,
  type Plane,
  perpendiculars,
  pointOnPlane,
  pointOnSpatialLine,
  prismatic,
  quaternion,
  revolute,
  SHEET,
  SPATIAL_SIZE,
  type SpatialBody,
  type SpatialPoint,
  spherical,
  turn,
  unit,
  unitQuaternion,
  universal,
  unturn,
  type Vec3,
} from "../solver/spatial.ts";
import { type AutoPose, expandComponents } from "./components.ts";

type Path = (string | number)[];

export interface CompiledBody {
  id: string;
  /** Index into the solver coordinates; -1 for ground. */
  index: number;
  /** Points in the body frame, in metres. */
  points: Map<string, { u: number; v: number }>;
  /** Depth order. Set by the model, or else worked out once the motion is known. */
  layer: number;
  /** Whether the model itself says which layer the body is on. */
  layerGiven: boolean;
  /** The real outline, where the model gives one, in metres. */
  shape?: Shape;
  /** The plane it moves on, named under `planes`; on the sheet when left out. */
  plane?: string;
  /** Whether the model leaves the body out of the drawing and of what is made. */
  hidden: boolean;
}

/** A body that moves in space. Its block of seven coordinates is in `q` at `at`. */
export interface CompiledSpatialBody {
  id: string;
  at: number;
  /** Points in the body frame, in metres. */
  points: Map<string, Vec3>;
}

/** How near two places on an outline count as one, in metres. */
const SAME_PLACE = 1e-9;

export interface CompiledMeasure {
  id: string;
  ast: Node;
}

export interface CompiledJoint {
  id: string;
  type: Exclude<Joint["type"], SpaceOnly>;
  /**
   * The points involved, each as `body.point`: the two connected points of a
   * revolute, weld, distance, gear or belt; the two axis points and then the pin of a
   * slider or pin-slot; the cam centre and then the follower of a cam.
   */
  points: string[];
  /** What is needed to draw a joint that is more than a pin. */
  detail?:
    | { kind: "wheels"; sizes: [number, number] }
    | {
        kind: "cam";
        /** Outlines in the cam's frame, in metres. */
        pitch: [number, number][];
        surface: [number, number][];
        roller: number;
      };
}

/** The joints that only work in space. */
type SpaceOnly = "spherical" | "universal" | "cylindrical" | "point-plane";

/** A joint between bodies in space, or between bodies on different planes. */
export interface CompiledSpatialJoint {
  id: string;
  type: SpaceOnly | "revolute" | "slider" | "pin-slot";
  /**
   * The points involved, each as `body.point`: the two it connects, or the points
   * of the line or plane and then the point kept on it.
   */
  points: string[];
  /** Where it is drawn, as the solver places it: the point it holds, or that rides on its line or plane. */
  at: SpatialPoint;
  /**
   * A direction to draw it along, in the frame of a body: a hinge's axis, a universal
   * joint's first pin, the line of a slider, or the normal of a plane.
   */
  axis?: SpatialBody & { a: Vec3 };
  /** For a hinge, what its angle is read from. */
  hinge?: SpaceHinge;
}

/**
 * A hinge in space: its two bodies, its axis in the first body's frame, and a
 * direction square to it in each body's frame, where the two lie together at the start.
 */
export interface SpaceHinge {
  a: SpatialBody;
  b: SpatialBody;
  axis: Vec3;
  fa: Vec3;
  fb: Vec3;
}

const SPACE_ONLY: ReadonlySet<string> = new Set<SpaceOnly>([
  "spherical",
  "universal",
  "cylindrical",
  "point-plane",
]);

export interface CompiledDriver {
  id: string;
  /** The revolute joint it turns. */
  joint: string;
  /** In rad/s. */
  speed: number;
  /** Relative angle at time 0, in rad. */
  phase: number;
}

/** A coordinate system that positions can be given in. */
export interface CompiledFrame {
  id: string;
  /** The point positions are counted from, as `body.point`; the origin of the sheet when left out. */
  origin?: string;
  /** How far its x axis is turned from what it follows, in rad. */
  angle: number;
  /** What its x axis follows: the line from one point to another, or the x axis of a body. */
  along?: [string, string];
  body?: string;
}

export interface CompiledPlot {
  id: string;
  series: { source: string; ast: Node }[];
}

export interface Compiled {
  units: Units;
  params: Map<string, Quantity>;
  /** The bounds of the parameters that have them, in the same terms as their values. */
  bounds: Map<string, { min?: number; max?: number }>;
  /** The bodies on the sheet, ground among them. */
  bodies: Map<string, CompiledBody>;
  /** Bodies in the plane that move on one of the model's `planes`, not on the sheet. */
  planeBodies: Map<string, CompiledBody>;
  /** The bodies that move in space. Their coordinates come after those of the bodies in the plane. */
  spatial: Map<string, CompiledSpatialBody>;
  /** The model's planes, in metres. */
  planes: Map<string, Plane>;
  model: SolverModel;
  /** The joints between bodies on the sheet. */
  joints: CompiledJoint[];
  /** The joints between bodies on one of the model's `planes`, each in that plane's terms. */
  planeJoints: CompiledJoint[];
  /** The joints in space: between bodies in space, or bodies on different planes. */
  spatialJoints: CompiledSpatialJoint[];
  drivers: CompiledDriver[];
  /** Duration of one motion cycle in seconds; 0 when nothing is driven. */
  period: number;
  /** Samples per cycle. */
  steps: number;
  traces: string[];
  frames: Map<string, CompiledFrame>;
  measures: CompiledMeasure[];
  /** Conditions the motion has to meet, read as measures are. */
  checks: CompiledMeasure[];
  plots: CompiledPlot[];
  /** Real dimensions of the parts where the model gives them, in metres. */
  fabrication: Partial<Fabrication>;
}

export interface CompileResult {
  compiled?: Compiled;
  diagnostics: Diagnostic[];
}

/**
 * `pi` and `g` are constants everywhere; `t` is the time in measures. The rest are
 * the words that join conditions.
 */
const RESERVED = new Set(["pi", "g", "t", ...KEYWORDS]);

/** Raised for a problem that is already recorded as a diagnostic. */
class Reported extends Error {}

/** `registry` adds units to the expressions; mekasim passes none. */
export function compile(source: Document, registry?: Registry): CompileResult {
  const { doc, autoPoses, origins, diagnostics } = expandComponents(source);
  const result = compileExpanded(doc, autoPoses, diagnostics, registry?.units);
  // A problem inside what a component stands for is reported on the component.
  for (const diagnostic of result.diagnostics) {
    const { path } = diagnostic;
    const origin = path && origins.find(({ prefix }) => prefix.every((key, i) => path[i] === key));
    if (origin) diagnostic.path = origin.to;
  }
  return result;
}

function compileExpanded(
  doc: Document,
  autoPoses: AutoPose[],
  diagnostics: Diagnostic[],
  extraUnits?: Registry["units"],
): CompileResult {
  const units: Units = { ...DEFAULT_UNITS, ...doc.meta?.units };

  function fail(message: string, path: Path): Reported {
    diagnostics.push({ severity: "error", message, path });
    return new Reported(message);
  }

  /** Run one independent piece of compilation, so that one error does not hide the next. */
  function attempt<T>(run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      if (error instanceof Reported) return undefined;
      throw error;
    }
  }

  // Parameters are evaluated on demand so they may refer to each other in any order.
  const params = new Map<string, Quantity>();
  const resolving = new Set<string>();
  const failed = new Set<string>();

  function param(name: string, node: Node): Quantity {
    const known = params.get(name);
    if (known) return known;
    const entry = doc.params?.[name];
    const source = entry === undefined ? undefined : paramValue(entry);
    if (source === undefined) {
      const hint = name.includes(".") ? "; points can only be used in measures" : "";
      throw new ExprError(`Unknown parameter "${name}"${hint}`, node.pos);
    }
    if (resolving.has(name)) throw new ExprError(`Parameter "${name}" depends on itself`, node.pos);
    if (failed.has(name)) throw new Reported();
    resolving.add(name);
    try {
      const path = typeof entry === "object" ? ["params", name, "value"] : ["params", name];
      const value = quantity(source, path);
      params.set(name, value);
      return value;
    } catch (error) {
      failed.add(name);
      throw error;
    } finally {
      resolving.delete(name);
    }
  }

  const context: EvalContext = { units, extraUnits, resolve: param };
  /** The bounds of the parameters that have them, in SI. */
  const bounds = new Map<string, { min?: number; max?: number }>();

  function parse(source: string, path: Path): Node {
    try {
      return parseExpr(source, extraUnits);
    } catch (error) {
      if (error instanceof ExprError) throw fail(`${error.message} in "${source}"`, path);
      throw error;
    }
  }

  function quantity(source: Expr, path: Path): Quantity {
    if (typeof source === "number") return { value: source, dim: NONE };
    const ast = parse(source, path);
    try {
      return evaluate(ast, context);
    } catch (error) {
      if (error instanceof Reported) throw error;
      if (error instanceof ExprError) throw fail(`${error.message} in "${source}"`, path);
      throw error;
    }
  }

  /** Evaluate a field to an SI number of the given dimension. */
  function scalar(source: Expr, dim: Dim, path: Path, bareUnit?: string): number {
    const q = quantity(source, path);
    try {
      return toSI(q, dim, units, bareUnit) as number;
    } catch (error) {
      if (error instanceof ExprError) throw fail(error.message, path);
      throw error;
    }
  }

  for (const name of Object.keys(doc.params ?? {})) {
    attempt(() => {
      if (RESERVED.has(name))
        throw fail(`"${name}" is a built-in name and cannot be a parameter`, ["params", name]);
      const value = param(name, { kind: "ref", name, pos: 0 });
      const entry = doc.params?.[name];
      if (typeof entry !== "object") return;

      // Bounds are read in the value's own kind of quantity, and the value must lie within them.
      const limits: { min?: number; max?: number } = {};
      for (const side of ["min", "max"] as const) {
        const written = entry[side];
        if (written === undefined) continue;
        const path = ["params", name, side];
        const bound = quantity(written, path);
        try {
          limits[side] = toSI(bound, value.dim, units) as number;
        } catch (error) {
          if (error instanceof ExprError) throw fail(error.message, path);
          throw error;
        }
      }
      bounds.set(name, limits);
      const show = (size: number): string => formatQuantity(size, value.dim, units);
      const { min, max } = limits;
      if (min !== undefined && max !== undefined && min > max)
        throw fail(`The least allowed, ${show(min)}, is more than the most, ${show(max)}`, [
          "params",
          name,
          "min",
        ]);
      const now = value.value as number;
      if (min !== undefined && now < min)
        throw fail(`${show(now)} is below the least allowed, ${show(min)}`, [
          "params",
          name,
          "value",
        ]);
      if (max !== undefined && now > max)
        throw fail(`${show(now)} is above the most allowed, ${show(max)}`, [
          "params",
          name,
          "value",
        ]);
    });
  }

  /** A shape as it is once those from drawings are written out, which `simulate` sees to. */
  type BodyShape = Extract<NonNullable<Document["bodies"][string]["shape"]>, { path: string }>;

  /**
   * The outline of a body. It is read and checked in the document's unit, so that a
   * problem is told in the numbers that were written, and kept in metres.
   */
  function shapeFrom(
    source: BodyShape,
    id: string,
    points: Map<string, { u: number; v: number }>,
  ): Shape {
    const at = ["bodies", id, "shape"];
    const unit = docFactor(LENGTH, units);
    try {
      const loops: Loop[] = parsePath(source.path);
      for (const [name, diameter] of Object.entries(source.holes ?? {})) {
        const path = [...at, "holes", name];
        const place = points.get(name);
        if (!place) throw fail(`Body "${id}" has no point "${name}"`, path);
        const size = scalar(diameter, LENGTH, path);
        if (size <= 0) throw fail("A hole's diameter must be more than zero", path);
        loops.push(circleLoop(place.u / unit, place.v / unit, size / 2 / unit));
      }
      return placeShape(shapeOf(loops, SAME_PLACE / unit), { scale: unit });
    } catch (error) {
      if (error instanceof OutlineError) throw fail(error.message, [...at, "path"]);
      throw error;
    }
  }

  /** A direction written in the model, as a unit vector. */
  function direction(source: Expr[], path: Path): Vec3 {
    const [x, y, z] = source.map((value, i) => scalar(value, NONE, [...path, i])) as Vec3;
    if (Math.hypot(x, y, z) < 1e-12) throw fail("A direction cannot be [0, 0, 0]", path);
    return unit([x, y, z]);
  }

  const planes = new Map<string, Plane>();
  for (const [id, plane] of Object.entries(doc.planes ?? {})) {
    const path = ["planes", id];
    attempt(() => {
      const origin = plane.origin.map((value, i) =>
        scalar(value, LENGTH, [...path, "origin", i]),
      ) as Vec3;
      const normal = direction(plane.normal, [...path, "normal"]);
      // The x axis, made square to the normal.
      const square = (a: Vec3): Vec3 => {
        const along = dot(a, normal);
        return [a[0] - along * normal[0], a[1] - along * normal[1], a[2] - along * normal[2]];
      };
      let x: Vec3;
      if (plane.x) {
        x = square(direction(plane.x, [...path, "x"]));
        if (Math.hypot(...x) < 1e-9)
          throw fail("The x axis must not be square to the plane", [...path, "x"]);
      } else {
        x = square([1, 0, 0]);
        if (Math.hypot(...x) < 1e-9) x = square([0, 1, 0]);
      }
      x = unit(x);
      planes.set(id, { origin, x, y: cross(normal, x), normal });
    });
  }

  const bodies = new Map<string, CompiledBody>();
  const spatial = new Map<string, CompiledSpatialBody>();
  const moving: string[] = [];
  /** Where each point of the ground is in the world. */
  const groundWorld = new Map<string, Vec3>();
  const planarCount = Object.entries(doc.bodies).filter(
    ([id, body]) => id !== GROUND && !body.spatial,
  ).length;
  for (const [id, body] of Object.entries(doc.bodies)) {
    const inSpace = body.spatial === true && id !== GROUND;
    if (body.spatial && id === GROUND)
      diagnostics.push({
        severity: "error",
        message: `"${GROUND}" is fixed, so spatial: true means nothing for it; its points may be [x, y, z] without it`,
        path: ["bodies", id, "spatial"],
      });
    if (body.plane !== undefined) {
      const why =
        id === GROUND
          ? `"${GROUND}" is fixed and on no plane; its points are where they are in the world`
          : inSpace
            ? "A body in space is on no plane"
            : planes.has(body.plane) || doc.planes?.[body.plane]
              ? undefined
              : `Unknown plane "${body.plane}"`;
      if (why) diagnostics.push({ severity: "error", message: why, path: ["bodies", id, "plane"] });
    }
    const points = new Map<string, { u: number; v: number }>();
    const spacePoints = new Map<string, Vec3>();
    for (const [name, [x, y, z]] of Object.entries(body.points)) {
      const path = ["bodies", id, "points", name];
      const u = attempt(() => scalar(x, LENGTH, [...path, 0]));
      const v = attempt(() => scalar(y, LENGTH, [...path, 1]));
      const w = z === undefined ? 0 : attempt(() => scalar(z, LENGTH, [...path, 2]));
      if (u === undefined || v === undefined || w === undefined) continue;
      if (inSpace) {
        spacePoints.set(name, [u, v, w]);
        continue;
      }
      if (w !== 0 && id !== GROUND) {
        attempt(() => {
          throw fail(
            "This body moves in the plane, so its points are on its plane; write them as [x, y], or give the body spatial: true",
            [...path, 2],
          );
        });
        continue;
      }
      if (id === GROUND) groundWorld.set(name, [u, v, w]);
      points.set(name, { u, v });
    }
    if (inSpace) {
      if (body.shape)
        diagnostics.push({
          severity: "error",
          message: "A body in space has no outline yet",
          path: ["bodies", id, "shape"],
        });
      spatial.set(id, {
        id,
        at: 3 * planarCount + SPATIAL_SIZE * spatial.size,
        points: spacePoints,
      });
      continue;
    }
    const index = id === GROUND ? GROUND_INDEX : moving.push(id) - 1;
    // A shape still waiting for its drawing is left out, as when the drawing is not attached.
    const written = body.shape && !("from" in body.shape) ? body.shape : undefined;
    const shape = written && attempt(() => shapeFrom(written, id, points));
    bodies.set(id, {
      id,
      index,
      points,
      shape,
      layer: body.layer ?? 0,
      layerGiven: body.layer !== undefined,
      hidden: body.hidden ?? false,
      ...(body.plane !== undefined && id !== GROUND && { plane: body.plane }),
    });
  }
  if (!bodies.has(GROUND)) {
    diagnostics.push({
      severity: "warning",
      message: `There is no "${GROUND}" body, so nothing holds the mechanism in place`,
      path: ["bodies"],
    });
  }

  /**
   * A point used by something in the plane: by a joint on `plane` (the sheet when left
   * out) when `inJoint`, or else by something that is only on the sheet so far. Points
   * of the ground are given in the plane's own terms.
   */
  function point(ref: string, path: Path, plane?: string, inJoint = false): BodyPoint {
    const [bodyId, name] = ref.split(".") as [string, string];
    if (spatial.has(bodyId))
      throw fail(
        `"${bodyId}" moves in space, and only bodies in the plane can be used here so far`,
        path,
      );
    const body = bodies.get(bodyId);
    if (!body) throw fail(`Unknown body "${bodyId}"`, path);
    if (body.index >= 0 && body.plane !== plane)
      throw fail(
        inJoint
          ? `"${bodyId}" is not on the same plane as the rest of this joint`
          : `"${bodyId}" is on the plane "${body.plane}", and only bodies on the sheet can be used here so far`,
        path,
      );
    const local = body.points.get(name);
    if (!local) {
      // A point that failed to evaluate has already been reported.
      if (doc.bodies[bodyId]?.points[name]) throw new Reported();
      throw fail(`Body "${bodyId}" has no point "${name}"`, path);
    }
    if (body.index >= 0) return { body: body.index, u: local.u, v: local.v };

    const world = groundWorld.get(name) as Vec3;
    const frame = plane === undefined ? SHEET : planes.get(plane);
    // A plane that failed to compile has already been reported.
    if (!frame) throw new Reported();
    const d: Vec3 = [
      world[0] - frame.origin[0],
      world[1] - frame.origin[1],
      world[2] - frame.origin[2],
    ];
    if (Math.abs(dot(d, frame.normal)) > 1e-9)
      throw fail(
        plane === undefined
          ? `"${ref}" is off the sheet, and only points on the sheet can be used here so far`
          : `"${ref}" is not on the plane "${plane}"`,
        path,
      );
    return { body: GROUND_INDEX, u: dot(d, frame.x), v: dot(d, frame.y) };
  }

  const q0 = new Float64Array(3 * moving.length + SPATIAL_SIZE * spatial.size);
  // A body in space starts unturned.
  for (const { at } of spatial.values()) q0[at + 3] = 1;

  for (const [id, pose] of Object.entries(doc.pose ?? {})) {
    const path = ["pose", id];
    attempt(() => {
      const inSpace = spatial.get(id);
      if (inSpace) {
        if (Array.isArray(pose))
          throw fail("A body in space takes its pose as { at: [x, y, z], axis, angle }", path);
        const at = pose.at.map((value, i) => scalar(value, LENGTH, [...path, "at", i]));
        const axis = direction(pose.axis ?? [0, 0, 1], [...path, "axis"]);
        const angle = scalar(pose.angle ?? 0, ANGLE, [...path, "angle"]);
        q0.set([...at, ...quaternion(axis, angle)], inSpace.at);
        return;
      }
      const body = bodies.get(id);
      if (!body) throw fail(`Unknown body "${id}"`, path);
      if (body.index < 0) throw fail(`"${GROUND}" is fixed and has no pose`, path);
      if (!Array.isArray(pose))
        throw fail("A body in the plane takes its pose as [x, y, angle]", path);
      const [x, y, angle] = pose;
      q0[3 * body.index] = scalar(x, LENGTH, [...path, 0]);
      q0[3 * body.index + 1] = scalar(y, LENGTH, [...path, 1]);
      q0[3 * body.index + 2] = scalar(angle, ANGLE, [...path, 2]);
    });
  }

  /** A point used by a joint in space, on any kind of body. */
  function spacePoint(ref: string, path: Path): SpatialPoint {
    const [bodyId, name] = ref.split(".") as [string, string];
    const missing = (): Reported => {
      // A point that failed to evaluate has already been reported.
      if (doc.bodies[bodyId]?.points[name]) return new Reported();
      return fail(`Body "${bodyId}" has no point "${name}"`, path);
    };
    const inSpace = spatial.get(bodyId);
    if (inSpace) {
      const s = inSpace.points.get(name);
      if (!s) throw missing();
      return { at: inSpace.at, s };
    }
    const body = bodies.get(bodyId);
    if (!body) throw fail(`Unknown body "${bodyId}"`, path);
    if (body.index < 0) {
      const s = groundWorld.get(name);
      if (!s) throw missing();
      return { at: -1, s };
    }
    const local = body.points.get(name);
    if (!local) throw missing();
    const plane = body.plane === undefined ? SHEET : planes.get(body.plane);
    // A plane that failed to compile has already been reported.
    if (!plane) throw new Reported();
    return { at: 3 * body.index, plane, s: [local.u, local.v, 0] };
  }

  /** Where a point is at the start, from the starting position of its body. */
  function startOf(p: BodyPoint): [number, number] {
    if (p.body < 0) return [p.u, p.v];
    const c = Math.cos(q0[3 * p.body + 2]);
    const s = Math.sin(q0[3 * p.body + 2]);
    return [q0[3 * p.body] + p.u * c - p.v * s, q0[3 * p.body + 1] + p.u * s + p.v * c];
  }

  // Bodies placed by what they attach to. One may attach to another, so place first
  // those whose attachments are already in place, and repeat.
  let waiting = [...autoPoses];
  while (waiting.length > 0) {
    const unplaced = new Set(waiting.map((item) => item.body));
    const ready = waiting.filter((item) => {
      const refs = "at" in item ? [item.at] : [item.from, item.to];
      return refs.every((ref) => !unplaced.has(ref.split(".")[0] as string));
    });
    // Bodies attached to each other in a ring have no first; place them as they stand.
    const batch = ready.length > 0 ? ready : waiting;
    for (const item of batch) {
      const path = ["components", item.body];
      attempt(() => {
        const index = (bodies.get(item.body) as CompiledBody).index;
        if ("at" in item) {
          const [x, y] = startOf(point(item.at, [...path, "at"]));
          q0.set([x, y, scalar(item.angle, ANGLE, [...path, "angle"])], 3 * index);
        } else {
          const [x, y] = startOf(point(item.from, [...path, "connect", 0]));
          const [tx, ty] = startOf(point(item.to, [...path, "connect", 1]));
          q0.set([x, y, Math.atan2(ty - y, tx - x)], 3 * index);
        }
      });
    }
    waiting = waiting.filter((item) => !batch.includes(item));
  }

  /**
   * The equations of a joint in space, pushed onto `constraints`, and what is drawn of
   * it. `axis` is a hinge's own axis, and `frame` the plane all its bodies in the plane
   * share, if they do.
   */
  function spaceJoint(
    id: string,
    joint: Joint,
    path: Path,
    axis: Vec3 | undefined,
    frame: Plane | undefined,
  ): CompiledSpatialJoint | undefined {
    const differ = (a: SpatialPoint, b: SpatialPoint, at: Path, message: string): void => {
      if (a.at === b.at) throw fail(message, at);
    };
    /** A direction given in the world at the start, in the frame of a point's body. */
    const local = (p: SpatialPoint, a: Vec3): Vec3 => unturn(q0, p, a);

    if (
      joint.type === "spherical" ||
      joint.type === "revolute" ||
      joint.type === "universal" ||
      joint.type === "cylindrical"
    ) {
      const a = spacePoint(joint.connect[0], [...path, "connect", 0]);
      const b = spacePoint(joint.connect[1], [...path, "connect", 1]);
      differ(a, b, [...path, "connect"], "A joint must connect two different bodies");
      const points = [...joint.connect];
      if (joint.type === "spherical") {
        constraints.push(spherical(id, a, b));
        return { id, type: joint.type, points, at: a };
      }
      if (joint.type === "universal") {
        const first = direction(joint.pins[0], [...path, "pins", 0]);
        const second = direction(joint.pins[1], [...path, "pins", 1]);
        if (Math.abs(dot(first, second)) > 1e-6)
          throw fail("The two pins of the cross must be square to each other", [...path, "pins"]);
        const ha = local(a, first);
        constraints.push(universal(id, a, b, ha, local(b, second)));
        return { id, type: joint.type, points, at: a, axis: { at: a.at, plane: a.plane, a: ha } };
      }
      if (joint.type === "cylindrical") {
        const along = direction(joint.axis, [...path, "axis"]);
        const ha = local(a, along);
        constraints.push(cylindrical(id, a, b, ha, local(b, along)));
        return { id, type: joint.type, points, at: b, axis: { at: a.at, plane: a.plane, a: ha } };
      }
      // Left out, a hinge turns about the normal of the plane its bodies are on.
      const along = axis ?? frame?.normal;
      if (!along)
        throw fail(
          "Its bodies are on different planes, so give the hinge an axis: which way it points",
          path,
        );
      const [f] = perpendiculars(along);
      const ha = local(a, along);
      constraints.push(revolute(id, a, b, ha, local(b, along)));
      const hinge = { a, b, axis: ha, fa: local(a, f), fb: local(b, f) };
      spaceHinges.set(id, hinge);
      return {
        id,
        type: joint.type,
        points,
        at: a,
        axis: { at: a.at, plane: a.plane, a: ha },
        hinge,
      };
    }

    if (joint.type === "slider" || joint.type === "pin-slot") {
      const from = spacePoint(joint.axis[0], [...path, "axis", 0]);
      const to = spacePoint(joint.axis[1], [...path, "axis", 1]);
      const pin = spacePoint(joint.point, [...path, "point"]);
      if (from.at !== to.at)
        throw fail("Both axis points must be on the same body", [...path, "axis"]);
      differ(from, pin, [...path, "point"], "The point must be on a different body than the axis");
      const d: Vec3 = [to.s[0] - from.s[0], to.s[1] - from.s[1], to.s[2] - from.s[2]];
      if (Math.hypot(...d) < 1e-12)
        throw fail("The two axis points coincide, so they define no direction", [...path, "axis"]);
      const ha = unit(d);
      const points = [...joint.axis, joint.point];
      const drawn = { at: pin, axis: { at: from.at, plane: from.plane, a: ha } };
      if (joint.type === "pin-slot") {
        constraints.push(pointOnSpatialLine(id, from, ha, pin));
        return { id, type: joint.type, points, ...drawn };
      }
      if (joint.angle !== undefined)
        throw fail("In space a slider keeps the turning it starts with, so leave out its angle", [
          ...path,
          "angle",
        ]);
      // The sliding body keeps the turning it starts with, relative to the axis's body.
      const world = turn(q0, from, ha);
      const [f] = perpendiculars(world);
      constraints.push(
        prismatic(id, from, pin, ha, local(pin, world), local(from, f), local(pin, f)),
      );
      return { id, type: joint.type, points, ...drawn };
    }

    if (joint.type === "point-plane") {
      const [p, q, r] = joint.surface.map((ref, i) => spacePoint(ref, [...path, "surface", i])) as [
        SpatialPoint,
        SpatialPoint,
        SpatialPoint,
      ];
      const pin = spacePoint(joint.point, [...path, "point"]);
      if (q.at !== p.at || r.at !== p.at)
        throw fail("The three points of the plane must be on the same body", [...path, "surface"]);
      differ(p, pin, [...path, "point"], "The point must be on a different body than the plane");
      const n = cross(
        [q.s[0] - p.s[0], q.s[1] - p.s[1], q.s[2] - p.s[2]],
        [r.s[0] - p.s[0], r.s[1] - p.s[1], r.s[2] - p.s[2]],
      );
      if (Math.hypot(...n) < 1e-12)
        throw fail("The three points lie on one line, so they make no plane", [...path, "surface"]);
      const normal = unit(n);
      constraints.push(pointOnPlane(id, p, normal, pin));
      return {
        id,
        type: joint.type,
        points: [...joint.surface, joint.point],
        at: pin,
        axis: { at: p.at, plane: p.plane, a: normal },
      };
    }
    throw fail(`A ${joint.type} joint stays in the plane`, path);
  }

  const constraints: Constraint[] = [];
  for (const { id, at } of spatial.values()) constraints.push(unitQuaternion(id, at));
  /** Bodies joined by each revolute joint, for drivers to act on. */
  const hinges = new Map<string, [number, number]>();
  /**
   * Hinges between bodies in space, for drivers to act on: the blocks of their two
   * bodies, the hinge's axis in the first body's frame, and a direction square to it
   * in each body's frame, where the two lie together at the start.
   */
  const spaceHinges = new Map<string, SpaceHinge>();
  const joints: CompiledJoint[] = [];
  const planeJoints: CompiledJoint[] = [];
  const spatialJoints: CompiledSpatialJoint[] = [];
  const drivers: CompiledDriver[] = [];

  for (const [id, joint] of Object.entries(doc.joints ?? {})) {
    const path = ["joints", id];
    attempt(() => {
      const refs =
        joint.type === "slider" || joint.type === "pin-slot"
          ? [...joint.axis, joint.point]
          : joint.type === "point-plane"
            ? [...joint.surface, joint.point]
            : joint.type === "cam"
              ? [joint.cam, joint.follower]
              : joint.connect;
      const sides = refs.map((ref) => ref.split(".")[0] as string);
      if ((joint.type === "gear" || joint.type === "belt") && joint.carrier !== undefined)
        sides.push(joint.carrier);
      // The plane of the joint's first moving body in the plane: the joint is on it, or in space.
      const flat = sides.map((side) => bodies.get(side)).filter((body) => body && body.index >= 0);
      const plane = flat[0]?.plane;
      const onOnePlane = flat.every((body) => body?.plane === plane);
      const frame = plane === undefined ? SHEET : planes.get(plane);
      const axis =
        joint.type === "revolute" && joint.axis
          ? direction(joint.axis, [...path, "axis"])
          : undefined;
      /** A point of the ground that is not on the joint's plane. */
      const offPlane = (ref: string): boolean => {
        const [side, name] = ref.split(".") as [string, string];
        const world = side === GROUND ? groundWorld.get(name) : undefined;
        if (!world || !frame) return false;
        const d: Vec3 = [
          world[0] - frame.origin[0],
          world[1] - frame.origin[1],
          world[2] - frame.origin[2],
        ];
        return Math.abs(dot(d, frame.normal)) > 1e-9;
      };
      const either =
        joint.type === "revolute" || joint.type === "slider" || joint.type === "pin-slot";
      const inSpace =
        SPACE_ONLY.has(joint.type) ||
        (either &&
          (sides.some((side) => spatial.has(side)) ||
            !onOnePlane ||
            (flat.length > 0 && refs.some(offPlane)) ||
            (axis !== undefined &&
              frame !== undefined &&
              Math.abs(Math.abs(dot(axis, frame.normal)) - 1) > 1e-9)));
      const flatJoints = plane === undefined ? joints : planeJoints;
      /** A point of the joint's plane, for a joint between bodies in the plane. */
      const flatPoint = (ref: string, at: Path): BodyPoint => point(ref, at, plane, true);

      if (inSpace) {
        const placed = spaceJoint(id, joint, path, axis, onOnePlane ? frame : undefined);
        if (placed) spatialJoints.push(placed);
        return;
      }

      if (joint.type === "revolute" || joint.type === "weld" || joint.type === "distance") {
        const a = flatPoint(joint.connect[0], [...path, "connect", 0]);
        const b = flatPoint(joint.connect[1], [...path, "connect", 1]);
        if (a.body === b.body)
          throw fail("A joint must connect two different bodies", [...path, "connect"]);
        if (joint.type === "distance") {
          constraints.push(distance(id, a, b, scalar(joint.length, LENGTH, [...path, "length"])));
        } else {
          const angle =
            joint.type === "weld" ? scalar(joint.angle ?? 0, ANGLE, [...path, "angle"]) : 0;
          constraints.push(coincident(id, a, b));
          if (joint.type === "weld") constraints.push(relativeAngle(id, a.body, b.body, angle));
          else hinges.set(id, [a.body, b.body]);
        }
        flatJoints.push({ id, type: joint.type, points: [...joint.connect] });
        return;
      }

      if (joint.type === "gear" || joint.type === "belt") {
        const a = flatPoint(joint.connect[0], [...path, "connect", 0]);
        const b = flatPoint(joint.connect[1], [...path, "connect", 1]);
        if (a.body === b.body)
          throw fail("The two wheels must be on different bodies", [...path, "connect"]);
        const first = quantity(joint.sizes[0], [...path, "sizes", 0]);
        const second = quantity(joint.sizes[1], [...path, "sizes", 1]);
        const sizes = [first.value, second.value];
        if (!compatible(first.dim, second.dim))
          throw fail("Give both sizes as tooth counts or both as diameters", [...path, "sizes"]);
        if (!sizes.every((size): size is number => typeof size === "number" && size > 0))
          throw fail("Sizes must be positive numbers", [...path, "sizes"]);
        let carrier = GROUND_INDEX;
        if (joint.carrier !== undefined) {
          const body = bodies.get(joint.carrier);
          if (!body) {
            const where = spatial.has(joint.carrier)
              ? `"${joint.carrier}" moves in space, and gears and belts stay in the plane`
              : `Unknown body "${joint.carrier}"`;
            throw fail(where, [...path, "carrier"]);
          }
          if (body.index >= 0 && body.plane !== plane)
            throw fail(`"${joint.carrier}" is not on the same plane as the rest of this joint`, [
              ...path,
              "carrier",
            ]);
          carrier = body.index;
        }
        // Meshing gears turn against each other; wheels on a belt turn the same way.
        const total = sizes[0] + sizes[1];
        const ka = sizes[0] / total;
        const kb = ((joint.type === "gear" ? 1 : -1) * sizes[1]) / total;
        const angleOf = (body: number): number => (body < 0 ? 0 : q0[3 * body + 2]);
        const constant =
          ka * (angleOf(a.body) - angleOf(carrier)) + kb * (angleOf(b.body) - angleOf(carrier));
        constraints.push(angleCoupling(id, a.body, b.body, carrier, ka, kb, constant));
        flatJoints.push({
          id,
          type: joint.type,
          points: [...joint.connect],
          detail: { kind: "wheels", sizes: [sizes[0], sizes[1]] },
        });
        return;
      }

      if (joint.type === "cam") {
        const centre = flatPoint(joint.cam, [...path, "cam"]);
        const follower = flatPoint(joint.follower, [...path, "follower"]);
        if (centre.body === follower.body)
          throw fail("The cam and its follower must be different bodies", [...path, "follower"]);
        const base = scalar(joint.base, LENGTH, [...path, "base"]);
        if (!(base > 0)) throw fail("The base radius must be positive", [...path, "base"]);
        const knots = joint.profile.map(([angle, lift], i) => ({
          angle: scalar(angle, ANGLE, [...path, "profile", i, 0]),
          lift: scalar(lift, LENGTH, [...path, "profile", i, 1]),
        }));
        knots.forEach((knot, i) => {
          const previous = knots[i - 1]?.angle ?? -1e-12;
          if (knot.angle <= previous || knot.angle >= 2 * Math.PI)
            throw fail("Profile angles must rise from 0 and stay below a full turn", [
              ...path,
              "profile",
              i,
              0,
            ]);
        });
        const roller = scalar(joint.roller ?? 0, LENGTH, [...path, "roller"]);
        const profile = camProfile(base, knots, joint.law ?? "cycloidal");
        constraints.push(camContact(id, centre, follower, profile));
        flatJoints.push({
          id,
          type: joint.type,
          points: [joint.cam, joint.follower],
          detail: { kind: "cam", roller, ...camOutlines(profile, roller) },
        });
        return;
      }

      // The joints that only work in space went there above.
      if (joint.type !== "slider" && joint.type !== "pin-slot") return;
      const from = flatPoint(joint.axis[0], [...path, "axis", 0]);
      const to = flatPoint(joint.axis[1], [...path, "axis", 1]);
      const pin = flatPoint(joint.point, [...path, "point"]);
      if (from.body !== to.body)
        throw fail("Both axis points must be on the same body", [...path, "axis"]);
      if (pin.body === from.body)
        throw fail("The point must be on a different body than the axis", [...path, "point"]);
      const length = Math.hypot(to.u - from.u, to.v - from.v);
      if (length < 1e-12)
        throw fail("The two axis points coincide, so they define no direction", [...path, "axis"]);
      const angle =
        joint.type === "slider" ? scalar(joint.angle ?? 0, ANGLE, [...path, "angle"]) : 0;
      constraints.push(
        pointOnLine(id, from, -(to.v - from.v) / length, (to.u - from.u) / length, pin),
      );
      if (joint.type === "slider") constraints.push(relativeAngle(id, from.body, pin.body, angle));
      flatJoints.push({ id, type: joint.type, points: [...joint.axis, joint.point] });
    });
  }

  let period = 0;
  for (const [id, driver] of Object.entries(doc.drivers ?? {})) {
    const path = ["drivers", id];
    attempt(() => {
      const hinge = hinges.get(driver.joint);
      const spaceHinge = spaceHinges.get(driver.joint);
      if (spaceHinge) {
        // In space the angle is counted from where the two bodies start.
        const { a, b, axis, fa, fb } = spaceHinge;
        const speed = scalar(driver.speed, ANGULAR_SPEED, [...path, "speed"], "rpm");
        const phase = scalar(driver.phase ?? 0, ANGLE, [...path, "phase"]);
        constraints.push(hingeAngle(id, a, b, axis, fa, fb, phase, speed, true));
        drivers.push({ id, joint: driver.joint, speed, phase });
        if (period === 0 && speed !== 0) period = (2 * Math.PI) / Math.abs(speed);
        return;
      }
      if (!hinge) {
        const joint = doc.joints?.[driver.joint];
        // A revolute joint missing here failed to compile and is already reported.
        if (joint?.type === "revolute") throw new Reported();
        throw fail(
          joint
            ? `Joint "${driver.joint}" is a ${joint.type}; only revolute joints can be driven`
            : `Unknown joint "${driver.joint}"`,
          [...path, "joint"],
        );
      }
      const speed = scalar(driver.speed, ANGULAR_SPEED, [...path, "speed"], "rpm");
      const phase = scalar(driver.phase ?? 0, ANGLE, [...path, "phase"]);
      constraints.push(relativeAngle(id, hinge[0], hinge[1], phase, speed, true));
      drivers.push({ id, joint: driver.joint, speed, phase });
      // The first moving driver sets the length of the cycle.
      if (period === 0 && speed !== 0) period = (2 * Math.PI) / Math.abs(speed);
    });
  }
  period *= doc.cycle?.revolutions ?? 1;

  const traces: string[] = [];
  (doc.traces ?? []).forEach((ref, i) => {
    attempt(() => {
      // A point off the sheet is traced where it is in the world.
      const bodyId = ref.split(".")[0] as string;
      if (spatial.has(bodyId) || bodies.get(bodyId)?.plane !== undefined)
        spacePoint(ref, ["traces", i]);
      else point(ref, ["traces", i]);
      traces.push(ref);
    });
  });

  const frames = new Map<string, CompiledFrame>();
  for (const [id, frame] of Object.entries(doc.frames ?? {})) {
    const path = ["frames", id];
    attempt(() => {
      if (frame.origin !== undefined) {
        const bodyId = frame.origin.split(".")[0] as string;
        if (spatial.has(bodyId) || bodies.get(bodyId)?.plane !== undefined)
          spacePoint(frame.origin, [...path, "origin"]);
        else point(frame.origin, [...path, "origin"]);
      }
      if (frame.along && frame.body !== undefined)
        throw fail("A frame follows either two points or a body, not both", [...path, "body"]);
      if (frame.along) {
        frame.along.forEach((ref, i) => {
          const bodyId = ref.split(".")[0] as string;
          if (spatial.has(bodyId) || bodies.get(bodyId)?.plane !== undefined)
            throw fail(
              "A frame can point along two points on the sheet only; off the sheet, let it follow a body with body:",
              [...path, "along", i],
            );
        });
        const from = point(frame.along[0], [...path, "along", 0]);
        const to = point(frame.along[1], [...path, "along", 1]);
        if (from.body === to.body && Math.hypot(to.u - from.u, to.v - from.v) < 1e-12)
          throw fail("The two points coincide, so they define no direction", [...path, "along"]);
      }
      if (frame.body !== undefined && !bodies.has(frame.body) && !spatial.has(frame.body))
        throw fail(`Unknown body "${frame.body}"`, [...path, "body"]);
      frames.set(id, {
        id,
        origin: frame.origin,
        angle: scalar(frame.angle ?? 0, ANGLE, [...path, "angle"]),
        along: frame.along,
        body: frame.body,
      });
    });
  }

  const measures: CompiledMeasure[] = [];
  for (const [id, source] of Object.entries(doc.measures ?? {})) {
    attempt(() => measures.push({ id, ast: parse(String(source), ["measures", id]) }));
  }

  const checks: CompiledMeasure[] = [];
  for (const [id, source] of Object.entries(doc.checks ?? {})) {
    attempt(() => {
      // A check and a measure are both used by name, so one name cannot be both.
      if (doc.measures && id in doc.measures)
        throw fail(`"${id}" is already the name of a measure`, ["checks", id]);
      checks.push({ id, ast: parse(source, ["checks", id]) });
    });
  }

  const plots: CompiledPlot[] = [];
  for (const [id, entry] of Object.entries(doc.plots ?? {})) {
    const sources = typeof entry === "string" ? [entry] : entry;
    const series: CompiledPlot["series"] = [];
    sources.forEach((source, i) => {
      const path = typeof entry === "string" ? ["plots", id] : ["plots", id, i];
      attempt(() => series.push({ source, ast: parse(source, path) }));
    });
    plots.push({ id, series });
  }

  const fabrication: Partial<Fabrication> = {};
  for (const key of ["width", "thickness", "hole", "clearance"] as const) {
    const value = doc.fabrication?.[key];
    if (value === undefined) continue;
    attempt(() => {
      const size = scalar(value, LENGTH, ["fabrication", key]);
      if (size < 0 || (size === 0 && key !== "clearance"))
        throw fail("This must be more than zero", ["fabrication", key]);
      fabrication[key] = size;
    });
  }

  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };
  return {
    compiled: {
      units,
      params,
      bounds,
      bodies: new Map([...bodies].filter(([, body]) => body.plane === undefined)),
      planeBodies: new Map([...bodies].filter(([, body]) => body.plane !== undefined)),
      spatial,
      planes,
      model: {
        bodies: moving,
        ...(spatial.size > 0 && {
          spatial: [...spatial.values()].map(({ id, points }) => ({
            id,
            size: SPATIAL_SIZE,
            points: [...points.values()],
          })),
        }),
        constraints,
        q0,
      },
      joints,
      planeJoints,
      spatialJoints,
      drivers,
      period,
      steps: doc.cycle?.steps ?? 360,
      traces,
      frames,
      measures,
      checks,
      plots,
      fabrication,
    },
    diagnostics,
  };
}
