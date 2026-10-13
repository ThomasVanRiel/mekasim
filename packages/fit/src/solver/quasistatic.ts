import {
  type Cycle,
  cycleFromPositions,
  jacobian,
  lengthOf,
  loopArea,
  mat,
  nullSpace,
  pinvSolve,
  residual,
  type Shape,
  type SolverModel,
  solvePosition,
  svd,
  TOLERANCE,
} from "@mekasim/core";
import type { FitCompiled } from "../contacts.ts";
import { contactInequalities, type Inequality, linearizeInequalities } from "./inequality.ts";
import { solveQp } from "./qp.ts";
import { springTerms } from "./springs.ts";
import { type CompiledMove, moveConstraint, moveDuration } from "./stages.ts";

/** Where a run stopped because the parts could not be put anywhere. */
export interface Jam {
  time: number;
  /** The one-sided rows that were touching in the last attempt. */
  rows: Inequality[];
  /** Joints and drivers left open in the last attempt, worst first. */
  open: string[];
}

export interface QuasistaticRun {
  cycle: Cycle;
  jam?: Jam;
}

/** Steps of the sequential program tried for one sample. */
const MAX_ITERATIONS = 30;
/** And for the first, in which the springs may carry the parts a long way before they rest. */
const MAX_SETTLING = 400;
/** How often a sample is split in two: against tunnelling, and before a jam is called. */
const MAX_SPLITS = 6;
/** A one-sided row may be this far past its limit and still count as met, in metres. */
const PENETRATION = 1e-9;
/** A step below this fraction of the model's size is no step. */
const SETTLED = 1e-10;
/** Rows nearer than this are named in a jam, in metres. */
const TOUCHING = 1e-6;
/** How much softer than the softest spring the resistance to being moved is. */
const RESISTANCE = 1e-6;

/** How thick a shape is on the whole: a long bar's width, a disc's radius. */
function thickness(shape: Shape): number {
  const around = shape.outer.segments.reduce((sum, segment) => sum + lengthOf(segment), 0);
  return around > 0 ? (2 * Math.abs(loopArea(shape.outer))) / around : 0;
}

type Attempt = { ok: true; q: Float64Array } | { ok: false; rows: Inequality[]; open: string[] };

/**
 * The motion of a mechanism whose parts touch and whose springs settle (DESIGN.md
 * §5): at each sample the spring energy is as low as the joints, the drivers and the
 * contacts allow. `moves` carry bodies through their stages; without any, the run
 * lasts the model's period.
 */
export function solveQuasistatic(
  compiled: FitCompiled,
  moves: CompiledMove[] = [],
): QuasistaticRun {
  const model: SolverModel = {
    ...compiled.model,
    constraints: [...compiled.model.constraints, ...moves.map(moveConstraint)],
  };
  const width = model.q0.length;
  const duration = moves.length > 0 ? Math.max(...moves.map(moveDuration)) : compiled.period;
  const intervals = duration > 0 ? compiled.steps : 0;

  // How far each body reaches from its origin, so that a turn weighs as the shift it makes.
  const reach = new Float64Array(model.bodies.length);
  let size = 1e-3;
  for (const body of compiled.bodies.values()) {
    if (body.index < 0) continue;
    let radius = body.shape?.radius ?? 0;
    for (const { u, v } of body.points.values()) radius = Math.max(radius, Math.hypot(u, v));
    reach[body.index] = radius;
    size = Math.max(size, radius);
  }
  const weight = new Float64Array(width).fill(1);
  reach.forEach((radius, body) => {
    weight[3 * body + 2] = (radius || size) ** 2;
  });

  // Bodies that nothing holds stay where they were: a resistance far below any spring's.
  let softest = Number.POSITIVE_INFINITY;
  for (const spring of compiled.springs) {
    const arm =
      spring.kind === "torsion"
        ? Math.max(weight[3 * spring.a + 2] ?? 0, weight[3 * spring.b + 2] ?? 0)
        : 1;
    softest = Math.min(softest, spring.stiffness / arm);
  }
  const eps = Number.isFinite(softest) ? RESISTANCE * softest : 1;

  // No point of a body that can touch another may pass a quarter of its thickness in one sample.
  const limits = new Map<number, { radius: number; most: number }>();
  for (const { a, b } of compiled.contacts) {
    for (const id of [a, b]) {
      const body = compiled.bodies.get(id);
      if (!body?.shape || body.index < 0) continue;
      limits.set(body.index, { radius: body.shape.radius, most: thickness(body.shape) / 4 });
    }
  }

  /** How much of the most it may go in one sample a step takes of the body that goes furthest. */
  function travel(step: (i: number) => number): number {
    let furthest = 0;
    for (const [body, { radius, most }] of limits) {
      const at = 3 * body;
      const shift = Math.hypot(step(at), step(at + 1)) + radius * Math.abs(step(at + 2));
      furthest = Math.max(furthest, shift / most);
    }
    return furthest;
  }

  function openSources(phi: Float64Array): string[] {
    const worst = new Map<string, number>();
    let row = 0;
    for (const constraint of model.constraints) {
      let error = 0;
      for (let k = 0; k < constraint.size; k++) error = Math.max(error, Math.abs(phi[row + k]));
      row += constraint.size;
      if (error > TOLERANCE)
        worst.set(constraint.source, Math.max(worst.get(constraint.source) ?? 0, error));
    }
    return [...worst].sort((x, y) => y[1] - x[1]).map(([source]) => source);
  }

  /** One sample: from the guess, step until the joints close, nothing overlaps and nothing moves. */
  function attempt(
    previous: Float64Array,
    guess: Float64Array,
    t: number,
    iterations = MAX_ITERATIONS,
  ): Attempt {
    const q = Float64Array.from(guess);
    let stepped = Number.POSITIVE_INFINITY;
    for (let iteration = 0; ; iteration++) {
      const phi = residual(model, q, t);
      const rows = contactInequalities(compiled, q);
      const closed = phi.every((value) => Math.abs(value) < TOLERANCE);
      if (closed && stepped < SETTLED * size && rows.every((row) => row.value > -PENETRATION))
        return { ok: true, q };
      const failed = (): Attempt => ({
        ok: false,
        rows: rows.filter((row) => row.value < TOUCHING),
        open: openSources(phi),
      });
      if (iteration >= iterations) return failed();

      // The joints leave some directions free; the step that closes them is core's own.
      const decomposition = svd(jacobian(model, q));
      const dq = pinvSolve(
        decomposition,
        phi.map((value) => -value),
      );
      const free = nullSpace(decomposition);
      const n = free.cols;
      if (n > 0) {
        const { gradient, hessian } = springTerms(compiled.springs, q);
        for (let i = 0; i < width; i++) {
          hessian.data[i * width + i] += eps * weight[i];
          gradient[i] += eps * weight[i] * (q[i] - previous[i]);
          // What the closing step already costs.
          for (let j = 0; j < width; j++) gradient[i] += hessian.data[i * width + j] * dq[j];
        }
        // The same program in the free directions only: dq = dq0 + N z.
        const { normals, limits: wanted } = linearizeInequalities(rows, width);
        const reduced = mat(n, n);
        const linear = new Float64Array(n);
        const sides = mat(rows.length, n);
        const hn = new Float64Array(width * n);
        for (let i = 0; i < width; i++) {
          for (let k = 0; k < n; k++) {
            let sum = 0;
            for (let j = 0; j < width; j++)
              sum += hessian.data[i * width + j] * free.data[j * n + k];
            hn[i * n + k] = sum;
          }
        }
        for (let a = 0; a < n; a++) {
          for (let i = 0; i < width; i++) {
            linear[a] += free.data[i * n + a] * gradient[i];
            for (let b = 0; b < n; b++)
              reduced.data[a * n + b] += free.data[i * n + a] * hn[i * n + b];
          }
        }
        // Rounding must not leave the two halves of the matrix a hair apart.
        for (let a = 0; a < n; a++) {
          for (let b = 0; b < a; b++) {
            const mean = (reduced.data[a * n + b] + reduced.data[b * n + a]) / 2;
            reduced.data[a * n + b] = mean;
            reduced.data[b * n + a] = mean;
          }
        }
        for (let r = 0; r < rows.length; r++) {
          for (let j = 0; j < width; j++) {
            const g = normals.data[r * width + j];
            if (g === 0) continue;
            wanted[r] -= g * dq[j];
            for (let k = 0; k < n; k++) sides.data[r * n + k] += g * free.data[j * n + k];
          }
        }
        const solved = solveQp(reduced, linear, sides, wanted);
        if (!solved) return failed();
        for (let i = 0; i < width; i++) {
          for (let k = 0; k < n; k++) dq[i] += free.data[i * n + k] * solved.x[k];
        }
      }

      // A step is laid out for the parts as they touch now. One that carries a body
      // further than it may go in a sample is cut short, so that it meets what is in its way.
      const scale =
        1 /
        Math.max(
          1,
          travel((i) => dq[i]),
        );
      stepped = 0;
      for (let i = 0; i < width; i++) {
        q[i] += scale * dq[i];
        stepped += weight[i] * dq[i] * dq[i];
      }
      stepped = Math.sqrt(stepped);
    }
  }

  const times: number[] = [];
  const samples: Float64Array[] = [];
  let jam: Jam | undefined;

  /** The sample at `t`, from the last one; split in two where that fails or moves too far. */
  function advance(t: number, splits: number): boolean {
    const last = samples[samples.length - 1] as Float64Array;
    const before = samples[samples.length - 2];
    const from = times[times.length - 1] as number;
    let result: Attempt | undefined;
    if (before) {
      // Carry on as the bodies were going; where that leads nowhere, start from where they are.
      const ratio = (t - from) / (from - (times[times.length - 2] as number));
      result = attempt(
        last,
        last.map((value, i) => value + ratio * (value - before[i])),
        t,
      );
    }
    if (!result?.ok) result = attempt(last, last, t);
    const reached = result.ok ? result.q : last;
    if (result.ok && (splits >= MAX_SPLITS || travel((i) => reached[i] - last[i]) <= 1)) {
      times.push(t);
      samples.push(result.q);
      return true;
    }
    if (splits >= MAX_SPLITS) {
      if (!result.ok) jam = { time: t, rows: result.rows, open: result.open };
      return false;
    }
    return advance((from + t) / 2, splits + 1) && advance(t, splits + 1);
  }

  // The joints close from the starting pose as in mekasim; then the springs and contacts settle.
  const start = Float64Array.from(model.q0);
  const assembled = solvePosition(model, start, 0, 200);
  if (!assembled.ok) {
    const none = new Float64Array(0);
    return {
      cycle: {
        steps: intervals + 1,
        count: 0,
        width,
        t: none,
        q: none,
        qd: none,
        qdd: none,
        failure: { step: 0, time: 0, open: assembled.open },
      },
    };
  }
  const settled = attempt(start, start, 0, MAX_SETTLING);
  times.push(0);
  samples.push(settled.ok ? settled.q : start);
  if (!settled.ok) jam = { time: 0, rows: settled.rows, open: settled.open };

  for (let k = 1; k <= intervals && !jam; k++) {
    if (!advance((k * duration) / intervals, 0)) break;
  }
  return {
    cycle: cycleFromPositions(times, samples, Math.max(intervals + 1, samples.length)),
    jam,
  };
}
