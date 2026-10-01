import type { Diagnostic } from "../diagnostics.ts";
import { type EvalContext, evaluate, type Quantity, toSI } from "../expr/evaluate.ts";
import { ExprError, type Node, parseExpr } from "../expr/parse.ts";
import {
  ANGLE,
  ANGULAR_SPEED,
  DEFAULT_UNITS,
  type Dim,
  LENGTH,
  NONE,
  type Units,
} from "../expr/units.ts";
import { type Document, type Expr, GROUND, type Joint } from "../schema/document.ts";
import {
  type BodyPoint,
  type Constraint,
  coincident,
  GROUND_INDEX,
  pointOnLine,
  relativeAngle,
} from "../solver/constraints.ts";
import type { SolverModel } from "../solver/solve.ts";

type Path = (string | number)[];

export interface CompiledBody {
  id: string;
  /** Index into the solver coordinates; -1 for ground. */
  index: number;
  /** Points in the body frame, in metres. */
  points: Map<string, { u: number; v: number }>;
  layer: number;
}

export interface CompiledMeasure {
  id: string;
  ast: Node;
}

export interface CompiledJoint {
  id: string;
  type: Joint["type"];
  /**
   * The points involved, each as `body.point`: the two connected points of a
   * revolute or weld; the two axis points and then the pin of a slider or pin-slot.
   */
  points: string[];
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

export interface Compiled {
  units: Units;
  params: Map<string, Quantity>;
  bodies: Map<string, CompiledBody>;
  model: SolverModel;
  joints: CompiledJoint[];
  drivers: CompiledDriver[];
  /** Duration of one motion cycle in seconds; 0 when nothing is driven. */
  period: number;
  /** Samples per cycle. */
  steps: number;
  traces: string[];
  measures: CompiledMeasure[];
}

export interface CompileResult {
  compiled?: Compiled;
  diagnostics: Diagnostic[];
}

/** `pi` and `g` are constants everywhere; `t` is the time in measures. */
const RESERVED = new Set(["pi", "g", "t"]);

/** Raised for a problem that is already recorded as a diagnostic. */
class Reported extends Error {}

export function compile(doc: Document): CompileResult {
  const diagnostics: Diagnostic[] = [];
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
    const source = doc.params?.[name];
    if (source === undefined) {
      const hint = name.includes(".") ? "; points can only be used in measures" : "";
      throw new ExprError(`Unknown parameter "${name}"${hint}`, node.pos);
    }
    if (resolving.has(name)) throw new ExprError(`Parameter "${name}" depends on itself`, node.pos);
    if (failed.has(name)) throw new Reported();
    resolving.add(name);
    try {
      const value = quantity(source, ["params", name]);
      params.set(name, value);
      return value;
    } catch (error) {
      failed.add(name);
      throw error;
    } finally {
      resolving.delete(name);
    }
  }

  const context: EvalContext = { units, resolve: param };

  function parse(source: string, path: Path): Node {
    try {
      return parseExpr(source);
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
      param(name, { kind: "ref", name, pos: 0 });
    });
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
    bodies.set(id, { id, index, points, layer: body.layer ?? 0 });
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

  const constraints: Constraint[] = [];
  /** Bodies joined by each revolute joint, for drivers to act on. */
  const hinges = new Map<string, [number, number]>();
  const joints: CompiledJoint[] = [];
  const drivers: CompiledDriver[] = [];

  for (const [id, joint] of Object.entries(doc.joints ?? {})) {
    const path = ["joints", id];
    attempt(() => {
      if (joint.type === "revolute" || joint.type === "weld") {
        const a = point(joint.connect[0], [...path, "connect", 0]);
        const b = point(joint.connect[1], [...path, "connect", 1]);
        if (a.body === b.body)
          throw fail("A joint must connect two different bodies", [...path, "connect"]);
        const angle =
          joint.type === "weld" ? scalar(joint.angle ?? 0, ANGLE, [...path, "angle"]) : 0;
        constraints.push(coincident(id, a, b));
        if (joint.type === "weld") constraints.push(relativeAngle(id, a.body, b.body, angle));
        else hinges.set(id, [a.body, b.body]);
        joints.push({ id, type: joint.type, points: [...joint.connect] });
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

  const traces: string[] = [];
  (doc.traces ?? []).forEach((ref, i) => {
    attempt(() => {
      point(ref, ["traces", i]);
      traces.push(ref);
    });
  });

  const measures: CompiledMeasure[] = [];
  for (const [id, source] of Object.entries(doc.measures ?? {})) {
    attempt(() => measures.push({ id, ast: parse(String(source), ["measures", id]) }));
  }

  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };
  return {
    compiled: {
      units,
      params,
      bodies,
      model: { bodies: moving, constraints, q0 },
      joints,
      drivers,
      period,
      steps: doc.cycle?.steps ?? 360,
      traces,
      measures,
    },
    diagnostics,
  };
}
