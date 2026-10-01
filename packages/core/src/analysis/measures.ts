import type { Compiled, CompiledBody } from "../compile/compile.ts";
import { type EvalContext, evaluate, type Quantity } from "../expr/evaluate.ts";
import { ExprError, type Node } from "../expr/parse.ts";
import { ANGLE, type Dim, LENGTH, TIME } from "../expr/units.ts";
import type { Cycle } from "./cycle.ts";

const SPEED: Dim = [1, -1, 0, 0];
const ACCELERATION: Dim = [1, -2, 0, 0];
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

/** Kinematic functions take bodies and points, not values, as arguments. */
const KINEMATIC = new Set([
  "x",
  "y",
  "dist",
  "moved",
  "angle",
  "v",
  "vx",
  "vy",
  "a",
  "ax",
  "ay",
  "omega",
  "alpha",
]);

/** Evaluate the measures and plots of a model over a solved cycle. */
export function evaluateMeasures(
  compiled: Compiled,
  cycle: Cycle,
): { measures: MeasureResult[]; plots: PlotResult[] } {
  const n = cycle.count;
  /** Measures evaluated so far; later measures and plots can use them by name. */
  const named = new Map<string, Quantity>();
  const motions = new Map<string, PointMotion>();

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

  function wrongArity(fn: Node & { kind: "call" }, wanted: string): ExprError {
    return new ExprError(`${fn.name}() takes ${wanted}, got ${fn.args.length}`, fn.pos);
  }

  function special(name: string, args: Node[], fn: Node): Quantity | undefined {
    if (!KINEMATIC.has(name)) return undefined;
    const call = fn as Node & { kind: "call" };
    const one = (): void => {
      if (args.length !== 1) throw wrongArity(call, "1 argument");
    };
    switch (name) {
      case "x":
      case "y":
        one();
        return { value: motion(args[0], fn)[name], dim: LENGTH };
      case "vx":
      case "vy":
        one();
        return { value: motion(args[0], fn)[name], dim: SPEED };
      case "ax":
      case "ay":
        one();
        return { value: motion(args[0], fn)[name], dim: ACCELERATION };
      case "v": {
        one();
        const m = motion(args[0], fn);
        return { value: signal((k) => Math.hypot(m.vx[k], m.vy[k])), dim: SPEED };
      }
      case "a": {
        one();
        const m = motion(args[0], fn);
        return { value: signal((k) => Math.hypot(m.ax[k], m.ay[k])), dim: ACCELERATION };
      }
      case "moved": {
        // How far a point is from where it started, whichever way it went.
        one();
        const m = motion(args[0], fn);
        return {
          value: signal((k) => Math.hypot(m.x[k] - m.x[0], m.y[k] - m.y[0])),
          dim: LENGTH,
        };
      }
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
  const plots = compiled.plots.map(
    ({ id, series }): PlotResult => ({
      id,
      series: series.map(({ source, ast }) => ({ source, ...attempt(ast) })),
    }),
  );
  return { measures, plots };
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
