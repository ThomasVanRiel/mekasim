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
}

/** How near two places on an outline count as one, in metres. */
const SAME_PLACE = 1e-9;

export interface CompiledMeasure {
  id: string;
  ast: Node;
}

export interface CompiledJoint {
  id: string;
  type: Joint["type"];
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
  bodies: Map<string, CompiledBody>;
  model: SolverModel;
  joints: CompiledJoint[];
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

  const bodies = new Map<string, CompiledBody>();
  const moving: string[] = [];
  for (const [id, body] of Object.entries(doc.bodies)) {
    const points = new Map<string, { u: number; v: number }>();
    for (const [name, [x, y]] of Object.entries(body.points)) {
      const path = ["bodies", id, "points", name];
      const u = attempt(() => scalar(x, LENGTH, [...path, 0]));
      const v = attempt(() => scalar(y, LENGTH, [...path, 1]));
      if (u !== undefined && v !== undefined) points.set(name, { u, v });
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
    });
  }
  if (!bodies.has(GROUND)) {
    diagnostics.push({
      severity: "warning",
      message: `There is no "${GROUND}" body, so nothing holds the mechanism in place`,
      path: ["bodies"],
    });
  }

  function point(ref: string, path: Path): BodyPoint {
    const [bodyId, name] = ref.split(".") as [string, string];
    const body = bodies.get(bodyId);
    if (!body) throw fail(`Unknown body "${bodyId}"`, path);
    const local = body.points.get(name);
    if (!local) {
      // A point that failed to evaluate has already been reported.
      if (doc.bodies[bodyId]?.points[name]) throw new Reported();
      throw fail(`Body "${bodyId}" has no point "${name}"`, path);
    }
    return { body: body.index, u: local.u, v: local.v };
  }

  const q0 = new Float64Array(3 * moving.length);
  for (const [id, [x, y, angle]] of Object.entries(doc.pose ?? {})) {
    const path = ["pose", id];
    attempt(() => {
      const body = bodies.get(id);
      if (!body) throw fail(`Unknown body "${id}"`, path);
      if (body.index < 0) throw fail(`"${GROUND}" is fixed and has no pose`, path);
      q0[3 * body.index] = scalar(x, LENGTH, [...path, 0]);
      q0[3 * body.index + 1] = scalar(y, LENGTH, [...path, 1]);
      q0[3 * body.index + 2] = scalar(angle, ANGLE, [...path, 2]);
    });
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

  const constraints: Constraint[] = [];
  /** Bodies joined by each revolute joint, for drivers to act on. */
  const hinges = new Map<string, [number, number]>();
  const joints: CompiledJoint[] = [];
  const drivers: CompiledDriver[] = [];

  for (const [id, joint] of Object.entries(doc.joints ?? {})) {
    const path = ["joints", id];
    attempt(() => {
      if (joint.type === "revolute" || joint.type === "weld" || joint.type === "distance") {
        const a = point(joint.connect[0], [...path, "connect", 0]);
        const b = point(joint.connect[1], [...path, "connect", 1]);
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
        joints.push({ id, type: joint.type, points: [...joint.connect] });
        return;
      }

      if (joint.type === "gear" || joint.type === "belt") {
        const a = point(joint.connect[0], [...path, "connect", 0]);
        const b = point(joint.connect[1], [...path, "connect", 1]);
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
          if (!body) throw fail(`Unknown body "${joint.carrier}"`, [...path, "carrier"]);
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
        joints.push({
          id,
          type: joint.type,
          points: [...joint.connect],
          detail: { kind: "wheels", sizes: [sizes[0], sizes[1]] },
        });
        return;
      }

      if (joint.type === "cam") {
        const centre = point(joint.cam, [...path, "cam"]);
        const follower = point(joint.follower, [...path, "follower"]);
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
        joints.push({
          id,
          type: joint.type,
          points: [joint.cam, joint.follower],
          detail: { kind: "cam", roller, ...camOutlines(profile, roller) },
        });
        return;
      }

      const from = point(joint.axis[0], [...path, "axis", 0]);
      const to = point(joint.axis[1], [...path, "axis", 1]);
      const pin = point(joint.point, [...path, "point"]);
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
      joints.push({ id, type: joint.type, points: [...joint.axis, joint.point] });
    });
  }

  let period = 0;
  for (const [id, driver] of Object.entries(doc.drivers ?? {})) {
    const path = ["drivers", id];
    attempt(() => {
      const hinge = hinges.get(driver.joint);
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
      point(ref, ["traces", i]);
      traces.push(ref);
    });
  });

  const frames = new Map<string, CompiledFrame>();
  for (const [id, frame] of Object.entries(doc.frames ?? {})) {
    const path = ["frames", id];
    attempt(() => {
      if (frame.origin !== undefined) point(frame.origin, [...path, "origin"]);
      if (frame.along && frame.body !== undefined)
        throw fail("A frame follows either two points or a body, not both", [...path, "body"]);
      if (frame.along) {
        const from = point(frame.along[0], [...path, "along", 0]);
        const to = point(frame.along[1], [...path, "along", 1]);
        if (from.body === to.body && Math.hypot(to.u - from.u, to.v - from.v) < 1e-12)
          throw fail("The two points coincide, so they define no direction", [...path, "along"]);
      }
      if (frame.body !== undefined && !bodies.has(frame.body))
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
      bodies,
      model: { bodies: moving, constraints, q0 },
      joints,
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
