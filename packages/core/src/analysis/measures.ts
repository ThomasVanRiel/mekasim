import type { Compiled, CompiledBody, CompiledFrame } from "../compile/compile.ts";
import { type EvalContext, evaluate, type Quantity } from "../expr/evaluate.ts";
import { ExprError, type Node } from "../expr/parse.ts";
import { ANGLE, type Dim, describeDim, isPure, LENGTH, TIME } from "../expr/units.ts";
import { type Cycle, cycleJerk } from "./cycle.ts";
import { lineTurning, type Path, seenFrom, type Turning } from "./frames.ts";

const SPEED: Dim = [1, -1, 0, 0];
const ACCELERATION: Dim = [1, -2, 0, 0];
const JERK: Dim = [1, -3, 0, 0];
const ANGULAR_SPEED: Dim = [0, -1, 0, 1];
const ANGULAR_ACCELERATION: Dim = [0, -2, 0, 1];

/** Position, velocity and acceleration of one point at every sample. */
export interface PointMotion {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
}

/** The jerk of one point at every sample. */
export interface PointJerk {
  jx: Float64Array;
  jy: Float64Array;
}

function splitRef(ref: string): [body: string, point: string | undefined] {
  const [body, point] = ref.split(".");
  return [body as string, point];
}

/**
 * The centre of a body in its own frame: the middle of its points. It is what the
 * position of a link means, since a link's own origin can be anywhere.
 */
export function centreOf(body: CompiledBody): { u: number; v: number } | undefined {
  if (body.points.size === 0) return undefined;
  let u = 0;
  let v = 0;
  for (const point of body.points.values()) {
    u += point.u / body.points.size;
    v += point.v / body.points.size;
  }
  return { u, v };
}

/** The motion of a point given as `body.point`, or of the centre of a body given as `body`. */
export function pointMotion(compiled: Compiled, cycle: Cycle, ref: string): PointMotion {
  const [bodyId, name] = splitRef(ref);
  const body = compiled.bodies.get(bodyId);
  const local = body && (name === undefined ? centreOf(body) : body.points.get(name));
  if (!body || !local) throw new Error(`Unknown point "${ref}"`);

  const n = cycle.count;
  const motion: PointMotion = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    ax: new Float64Array(n),
    ay: new Float64Array(n),
  };
  if (body.index < 0) {
    motion.x.fill(local.u);
    motion.y.fill(local.v);
    return motion;
  }

  const { q, qd, qdd, width } = cycle;
  for (let k = 0; k < n; k++) {
    const at = k * width + 3 * body.index;
    const phi = q[at + 2];
    const w = qd[at + 2];
    const alpha = qdd[at + 2];
    const bx = local.u * Math.cos(phi) - local.v * Math.sin(phi);
    const by = local.u * Math.sin(phi) + local.v * Math.cos(phi);
    motion.x[k] = q[at] + bx;
    motion.y[k] = q[at + 1] + by;
    motion.vx[k] = qd[at] - w * by;
    motion.vy[k] = qd[at + 1] + w * bx;
    motion.ax[k] = qdd[at] - alpha * by - w * w * bx;
    motion.ay[k] = qdd[at + 1] + alpha * bx - w * w * by;
  }
  return motion;
}

/**
 * The jerk of a point, or of the centre of a body, at every sample. `qddd` holds the
 * jerks of the cycle, as `cycleJerk` gives them.
 */
export function pointJerk(
  compiled: Compiled,
  cycle: Cycle,
  qddd: Float64Array,
  ref: string,
): PointJerk {
  const [bodyId, name] = splitRef(ref);
  const body = compiled.bodies.get(bodyId);
  const local = body && (name === undefined ? centreOf(body) : body.points.get(name));
  if (!body || !local) throw new Error(`Unknown point "${ref}"`);

  const n = cycle.count;
  const jerk: PointJerk = { jx: new Float64Array(n), jy: new Float64Array(n) };
  if (body.index < 0) return jerk;

  const { q, qd, qdd, width } = cycle;
  for (let k = 0; k < n; k++) {
    const at = k * width + 3 * body.index;
    const phi = q[at + 2];
    const w = qd[at + 2];
    const alpha = qdd[at + 2];
    const beta = qddd[at + 2];
    const bx = local.u * Math.cos(phi) - local.v * Math.sin(phi);
    const by = local.u * Math.sin(phi) + local.v * Math.cos(phi);
    jerk.jx[k] = qddd[at] - (beta - w ** 3) * by - 3 * alpha * w * bx;
    jerk.jy[k] = qddd[at + 1] + (beta - w ** 3) * bx - 3 * alpha * w * by;
  }
  return jerk;
}

/** Remove the jumps of 2 pi that `atan2` introduces along a signal. */
function unwrap(angles: Float64Array): Float64Array {
  let offset = 0;
  for (let k = 1; k < angles.length; k++) {
    const raw = angles[k] + offset;
    const step = raw - angles[k - 1];
    if (step > Math.PI) offset -= 2 * Math.PI;
    else if (step < -Math.PI) offset += 2 * Math.PI;
    angles[k] = angles[k] + offset;
  }
  return angles;
}

export interface PlotSeries {
  /** The expression as written. */
  source: string;
  quantity?: Quantity;
  error?: string;
}

export interface PlotResult {
  id: string;
  series: PlotSeries[];
}

export interface MeasureResult {
  id: string;
  /** A number, or a signal with one value per solved sample. */
  quantity?: Quantity;
  error?: string;
}

export interface CheckResult {
  id: string;
  /** Whether the condition is met: at every solved sample, when it varies over the cycle. */
  holds?: boolean;
  /** For a condition that varies and is not met throughout: at how many samples, and the first. */
  fails?: { count: number; first: number };
  /** The condition as evaluated: 0 where it is not met. */
  quantity?: Quantity;
  error?: string;
}

/** Whether a condition is met, and where it is not when it varies over the cycle. */
function verdict(id: string, quantity: Quantity): CheckResult {
  const { value } = quantity;
  if (typeof value === "number") return { id, quantity, holds: value !== 0 };
  let count = 0;
  let first = -1;
  value.forEach((sample, k) => {
    if (sample !== 0) return;
    if (count === 0) first = k;
    count++;
  });
  return count === 0
    ? { id, quantity, holds: true }
    : { id, quantity, holds: false, fails: { count, first } };
}

/** Functions of one point. Each takes a frame to see the point from as a second argument. */
const OF_POINT = new Set([
  "x",
  "y",
  "r",
  "theta",
  "moved",
  "v",
  "vx",
  "vy",
  "vr",
  "vt",
  "a",
  "ax",
  "ay",
  "ar",
  "at",
  "j",
  "jx",
  "jy",
  "jr",
  "jt",
]);

/** Kinematic functions take bodies and points, not values, as arguments. */
const KINEMATIC = new Set([...OF_POINT, "dist", "angle", "omega", "alpha"]);

/** Evaluate the measures, checks and plots of a model over a solved cycle. */
export function evaluateMeasures(
  compiled: Compiled,
  cycle: Cycle,
): { measures: MeasureResult[]; checks: CheckResult[]; plots: PlotResult[] } {
  const n = cycle.count;
  /** Measures and checks evaluated so far; what comes after them can use them by name. */
  const named = new Map<string, Quantity>();
  const motions = new Map<string, PointMotion>();
  const jerks = new Map<string, PointJerk>();
  /** Motions as seen from frames, by point, frame and whether the jerk is among them. */
  const views = new Map<string, Path>();
  let qddd: Float64Array | undefined;

  function refName(node: Node | undefined, fn: Node): string {
    if (node?.kind !== "ref") {
      throw new ExprError(
        `${(fn as Node & { kind: "call" }).name}() takes a body or a point such as rocker.B`,
        fn.pos,
      );
    }
    return node.name;
  }

  function motion(node: Node | undefined, fn: Node): PointMotion {
    const ref = refName(node, fn);
    const known = motions.get(ref);
    if (known) return known;
    const [bodyId, name] = splitRef(ref);
    const body = compiled.bodies.get(bodyId);
    if (!body) throw new ExprError(`Unknown body "${bodyId}"`, (node as Node).pos);
    // A body stands for its centre.
    if (name === undefined && body.points.size === 0)
      throw new ExprError(
        `Body "${bodyId}" has no points, so it has no centre`,
        (node as Node).pos,
      );
    if (name !== undefined && !body.points.has(name))
      throw new ExprError(`Body "${bodyId}" has no point "${name}"`, (node as Node).pos);
    const result = pointMotion(compiled, cycle, ref);
    motions.set(ref, result);
    return result;
  }

  function jerk(node: Node | undefined, fn: Node): PointJerk {
    // Checks the point, and says what is wrong with it.
    motion(node, fn);
    const ref = refName(node, fn);
    const known = jerks.get(ref);
    if (known) return known;
    qddd ??= cycleJerk(compiled.model, cycle);
    const result = pointJerk(compiled, cycle, qddd, ref);
    jerks.set(ref, result);
    return result;
  }

  function body(node: Node | undefined, fn: Node): CompiledBody {
    const ref = refName(node, fn);
    const found = compiled.bodies.get(ref);
    if (!found) throw new ExprError(`Unknown body "${ref}"`, (node as Node).pos);
    return found;
  }

  /** One coordinate of a body over the cycle: 0 = x, 1 = y, 2 = angle. */
  function coordinate(source: Float64Array, target: CompiledBody, k: number): Float64Array {
    const out = new Float64Array(n);
    if (target.index < 0) return out;
    for (let i = 0; i < n; i++) out[i] = source[i * cycle.width + 3 * target.index + k];
    return out;
  }

  function signal(f: (k: number) => number): Float64Array {
    return new Float64Array(n).map((_, k) => f(k));
  }

  /** A point of a frame, which the model has already checked, as if it were written at `at`. */
  function framePoint(ref: string, at: Node, fn: Node, withJerk: boolean): Path {
    const node: Node = { kind: "ref", name: ref, pos: at.pos };
    return withJerk ? { ...motion(node, fn), ...jerk(node, fn) } : motion(node, fn);
  }

  /** How a frame's x axis is turned over the cycle; undefined when it stays that of the sheet. */
  function turningOf(
    frame: CompiledFrame,
    at: Node,
    fn: Node,
    withJerk: boolean,
  ): Turning | undefined {
    if (frame.along) {
      const [from, to] = frame.along.map((ref) => framePoint(ref, at, fn, withJerk)) as [
        Path,
        Path,
      ];
      const turning = lineTurning(from, to, frame.angle);
      if (!turning)
        throw new ExprError(
          `The two points that frame "${frame.id}" points along come together, so it has no direction there`,
          at.pos,
        );
      return turning;
    }
    if (frame.body !== undefined) {
      const turned = compiled.bodies.get(frame.body) as CompiledBody;
      if (withJerk) qddd ??= cycleJerk(compiled.model, cycle);
      return {
        angle: coordinate(cycle.q, turned, 2).map((angle) => angle + frame.angle),
        w: coordinate(cycle.qd, turned, 2),
        alpha: coordinate(cycle.qdd, turned, 2),
        beta: withJerk && qddd ? coordinate(qddd, turned, 2) : undefined,
      };
    }
    if (frame.angle === 0) return undefined;
    const still = new Float64Array(n);
    return { angle: new Float64Array(n).fill(frame.angle), w: still, alpha: still, beta: still };
  }

  /**
   * The motion of the point a function is given, on the sheet or, when a frame is
   * named after the point, as seen from that frame.
   */
  function seen(call: Node & { kind: "call" }, withJerk = false): Path {
    const { args } = call;
    if (args.length < 1 || args.length > 2)
      throw wrongArity(call, "a point, and a frame to see it from if wanted");
    const world: Path = withJerk
      ? { ...motion(args[0], call), ...jerk(args[0], call) }
      : motion(args[0], call);
    const named = args[1];
    if (!named) return world;
    const frame = named.kind === "ref" ? compiled.frames.get(named.name) : undefined;
    if (!frame) {
      throw new ExprError(
        named.kind === "ref"
          ? `Unknown frame "${named.name}"`
          : `${call.name}() takes a point, and the name of a frame to see it from if wanted`,
        named.pos,
      );
    }
    const key = `${refName(args[0], call)} ${frame.id} ${withJerk}`;
    const known = views.get(key);
    if (known) return known;
    const origin =
      frame.origin === undefined ? undefined : framePoint(frame.origin, named, call, withJerk);
    const view = seenFrom(world, origin, turningOf(frame, named, call, withJerk));
    views.set(key, view);
    return view;
  }

  /** The part of a vector along the line from the frame's origin to the point, and the part across it. */
  function polar(
    m: Path,
    vx: Float64Array,
    vy: Float64Array,
    part: "radial" | "transverse",
  ): Float64Array {
    return signal((k) => {
      const r = Math.hypot(m.x[k], m.y[k]);
      // On the origin itself there is no such line.
      if (r < 1e-12) return 0;
      return part === "radial"
        ? (m.x[k] * vx[k] + m.y[k] * vy[k]) / r
        : (m.x[k] * vy[k] - m.y[k] * vx[k]) / r;
    });
  }

  function wrongArity(fn: Node & { kind: "call" }, wanted: string): ExprError {
    return new ExprError(`${fn.name}() takes ${wanted}, got ${fn.args.length}`, fn.pos);
  }

  function special(name: string, args: Node[], fn: Node): Quantity | undefined {
    if (!KINEMATIC.has(name)) return undefined;
    const call = fn as Node & { kind: "call" };
    const one = (): void => {
      if (args.length !== 1) throw wrongArity(call, "1 argument");
    };
    if (OF_POINT.has(name)) {
      const size = (xs: Float64Array, ys: Float64Array): Float64Array =>
        signal((k) => Math.hypot(xs[k], ys[k]));
      const part = name.endsWith("r") ? "radial" : "transverse";
      switch (name) {
        case "x":
        case "y":
          return { value: seen(call)[name], dim: LENGTH };
        case "r": {
          const m = seen(call);
          return { value: size(m.x, m.y), dim: LENGTH };
        }
        case "theta": {
          const m = seen(call);
          return { value: unwrap(signal((k) => Math.atan2(m.y[k], m.x[k]))), dim: ANGLE };
        }
        case "moved": {
          // How far a point is from where it started, whichever way it went.
          const m = seen(call);
          return {
            value: signal((k) => Math.hypot(m.x[k] - m.x[0], m.y[k] - m.y[0])),
            dim: LENGTH,
          };
        }
        case "vx":
        case "vy":
          return { value: seen(call)[name], dim: SPEED };
        case "v": {
          const m = seen(call);
          return { value: size(m.vx, m.vy), dim: SPEED };
        }
        case "vr":
        case "vt": {
          const m = seen(call);
          return { value: polar(m, m.vx, m.vy, part), dim: SPEED };
        }
        case "ax":
        case "ay":
          return { value: seen(call)[name], dim: ACCELERATION };
        case "a": {
          const m = seen(call);
          return { value: size(m.ax, m.ay), dim: ACCELERATION };
        }
        case "ar":
        case "at": {
          const m = seen(call);
          return { value: polar(m, m.ax, m.ay, part), dim: ACCELERATION };
        }
        default: {
          // The jerk, in one of its forms.
          const m = seen(call, true);
          const { jx, jy } = m as Path & PointJerk;
          if (name === "jx" || name === "jy") return { value: name === "jx" ? jx : jy, dim: JERK };
          return { value: name === "j" ? size(jx, jy) : polar(m, jx, jy, part), dim: JERK };
        }
      }
    }
    switch (name) {
      case "dist": {
        if (args.length !== 2) throw wrongArity(call, "2 points");
        const p = motion(args[0], fn);
        const q = motion(args[1], fn);
        const value = signal((k) => Math.hypot(q.x[k] - p.x[k], q.y[k] - p.y[k]));
        return { value, dim: LENGTH };
      }
      case "omega":
        one();
        return { value: coordinate(cycle.qd, body(args[0], fn), 2), dim: ANGULAR_SPEED };
      case "alpha":
        one();
        return { value: coordinate(cycle.qdd, body(args[0], fn), 2), dim: ANGULAR_ACCELERATION };
      case "angle": {
        if (args.length === 1)
          return { value: coordinate(cycle.q, body(args[0], fn), 2), dim: ANGLE };
        if (args.length === 2) {
          // Direction of the line from the first point to the second.
          const p = motion(args[0], fn);
          const q = motion(args[1], fn);
          const value = signal((k) => Math.atan2(q.y[k] - p.y[k], q.x[k] - p.x[k]));
          return { value: unwrap(value), dim: ANGLE };
        }
        if (args.length === 3) {
          // Angle at the middle point, turning from the first point to the third.
          const p = motion(args[0], fn);
          const o = motion(args[1], fn);
          const q = motion(args[2], fn);
          const value = signal((k) => {
            const ux = p.x[k] - o.x[k];
            const uy = p.y[k] - o.y[k];
            const vx = q.x[k] - o.x[k];
            const vy = q.y[k] - o.y[k];
            return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
          });
          return { value: unwrap(value), dim: ANGLE };
        }
        throw wrongArity(call, "a body, 2 points or 3 points");
      }
    }
    return undefined;
  }

  const context: EvalContext = {
    units: compiled.units,
    resolve(name, node) {
      if (name === "t") return { value: Float64Array.from(cycle.t), dim: TIME };
      const param = compiled.params.get(name);
      if (param) return param;
      const measure = named.get(name);
      if (measure) return measure;
      const hint = compiled.bodies.has(name.split(".")[0] as string)
        ? "; wrap it in a function such as x() or angle()"
        : "";
      throw new ExprError(`Unknown name "${name}"${hint}`, node.pos);
    },
    special,
  };

  function attempt(ast: Node): { quantity?: Quantity; error?: string } {
    try {
      return { quantity: evaluate(ast, context) };
    } catch (error) {
      if (error instanceof ExprError) return { error: error.message };
      throw error;
    }
  }

  const measures = compiled.measures.map(({ id, ast }): MeasureResult => {
    const result = attempt(ast);
    if (result.quantity) named.set(id, result.quantity);
    return { id, ...result };
  });
  const checks = compiled.checks.map(({ id, ast }): CheckResult => {
    const { quantity, error } = attempt(ast);
    if (!quantity) return { id, error };
    if (!isPure(quantity.dim)) {
      return {
        id,
        error: `A check is a condition, such as max(x(rod.B)) < 40 mm, and this is ${describeDim(quantity.dim)}`,
      };
    }
    named.set(id, quantity);
    return verdict(id, quantity);
  });
  const plots = compiled.plots.map(
    ({ id, series }): PlotResult => ({
      id,
      series: series.map(({ source, ast }) => ({ source, ...attempt(ast) })),
    }),
  );
  return { measures, checks, plots };
}

/**
 * What a cycle is plotted against: the angle of the first driver, which is how a
 * mechanism's motion is usually read, or time when nothing turns.
 */
export function cycleAxis(compiled: Compiled, cycle: Cycle): { label: string; quantity: Quantity } {
  const driver = compiled.drivers.find((d) => d.speed !== 0);
  if (!driver) return { label: "time", quantity: { value: Float64Array.from(cycle.t), dim: TIME } };
  return {
    label: `${driver.id} angle`,
    quantity: { value: cycle.t.map((t) => driver.phase + driver.speed * t), dim: ANGLE },
  };
}
