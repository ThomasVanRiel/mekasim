import {
  type Cycle,
  cycleFromPositions,
  jacobian,
  lengthOf,
  loopArea,
  type Mat,
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
import { catchTerms } from "./catches.ts";
import {
  contactInequalities,
  type Inequality,
  jointValue,
  linearizeInequalities,
  lockInequalities,
  stopInequalities,
} from "./inequality.ts";
import { solveQp } from "./qp.ts";
import { springTerms, springValue } from "./springs.ts";
import { moveConstraint, plannedStarts, stageAt, stageEnds } from "./stages.ts";

/** Where a run stopped because the parts could not be put anywhere. */
export interface Jam {
  time: number;
  /** The one-sided rows that were touching in the last attempt. */
  rows: Inequality[];
  /** Joints and drivers left open in the last attempt, worst first. */
  open: string[];
}

/**
 * What the parts carry at each sample, found from their balance once a sample is
 * solved. Forces in newtons, torques in newton metres, one value per sample.
 */
export interface Loads {
  /** The force pressing the parts of each `contacts` entry together, all its places added up. */
  contacts: Record<string, Float64Array>;
  /**
   * What each spring carries, counted as its preload is: the tension of a straight
   * spring, and the torque with which a spring on a joint turns it the positive way.
   */
  springs: Record<string, Float64Array>;
  /** How hard each joint with stops is held against one of them. */
  stops: Record<string, Float64Array>;
  /** How hard each lock is held against. */
  locks: Record<string, Float64Array>;
  /**
   * What each driver puts on the body it moves: the force and the torque about the
   * body's origin for a move, the torque for a motor.
   */
  drivers: Record<string, { x: Float64Array; y: Float64Array; torque: Float64Array }>;
}

/** A cycle with what the contact step found beside the motion. */
export type FitCycle = Cycle & Partial<Omit<QuasistaticRun, "cycle">>;

export interface QuasistaticRun {
  cycle: Cycle;
  jam?: Jam;
  /** The pulls that nothing held: the driver, and when its pull ended. A result, not a fault. */
  free: { driver: string; time: number }[];
  /** Whether each lock is in at each sample: 1 or 0. */
  latched: Record<string, Float64Array>;
  loads: Loads;
}

/** Steps of the sequential program tried for one sample. */
const MAX_ITERATIONS = 30;
/** And for the first, in which the springs may carry the parts a long way before they rest. */
const MAX_SETTLING = 400;
/** How often a sample is split in two: against tunnelling, and before a jam is called. */
const MAX_SPLITS = 6;
/** A one-sided row may be this far past its limit and still count as met, in metres. */
const PENETRATION = 1e-9;
/**
 * Where a sample's steps run out before the parts come to rest, they may be this far
 * into each other and still be taken as they are, in metres: the next sample takes them
 * on from there and out of each other.
 */
const UNSETTLED_PENETRATION = 1e-6;
/**
 * Steps tried, once a sample's are spent with the parts not quite out of each other,
 * that only take them out: the least move that clears them, the springs left aside.
 */
const MAX_CLEARING = 10;
/** A step below this fraction of the model's size is no step. */
const SETTLED = 1e-10;
/** Joints and contacts this near to met leave the step to the springs, in metres. */
const NEARLY = 1e-7;
/** The least part of a closing step that is tried where the whole of it cannot be taken. */
const LEAST_PART = 1e-4;
/** Rows nearer than this are named in a jam, in metres. */
const TOUCHING = 1e-6;
/** A body that is let go covers at most this many times the model's size in its stage. */
const FREE_PACE = 1;
/** A force below this fraction of the largest in a sample is none. */
const NO_FORCE = 1e-9;
/** How much softer than the softest spring the resistance to being moved is. */
const RESISTANCE = 1e-6;

/** How thick a shape is on the whole: a long bar's width, a disc's radius. */
function thickness(shape: Shape): number {
  const around = shape.outer.segments.reduce((sum, segment) => sum + lengthOf(segment), 0);
  return around > 0 ? (2 * Math.abs(loopArea(shape.outer))) / around : 0;
}

type Attempt =
  | { ok: true; q: Float64Array; limited: string[] }
  | { ok: false; rows: Inequality[]; open: string[] };

/**
 * The motion of a mechanism whose parts touch and whose springs settle (DESIGN.md
 * §5): at each sample the spring energy is as low as the joints, the drivers and the
 * contacts allow. The run lasts the model's period: the time its moves take, or one
 * cycle of its motor.
 */
export function solveQuasistatic(compiled: FitCompiled): QuasistaticRun {
  const { model, moves } = compiled;
  const width = model.q0.length;
  const duration = compiled.period;
  const intervals = duration > 0 ? compiled.steps : 0;

  // A move holds its body only in its `to` stages, and from where the run has taken it.
  const moved = new Set(moves.map((move) => move.id));
  const joints = model.constraints.filter((c) => !(c.driver && moved.has(c.source)));
  const starts = moves.map(plannedStarts);
  const holds = moves.map((move, m) => moveConstraint(move, starts[m]));
  const modelAt = (t: number): SolverModel => ({
    ...model,
    constraints: [
      ...joints,
      ...holds.filter(
        (_, m) => stageAt(moves[m] as (typeof moves)[number], t)?.stage.kind !== "pull",
      ),
    ],
  });

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

  /** The cost of a step by how far it moves the bodies, a turn weighed as the shift it makes. */
  function movedTerms(): { gradient: Float64Array; hessian: Mat } {
    const hessian = mat(width, width);
    for (let i = 0; i < width; i++) hessian.data[i * width + i] = weight[i] as number;
    return { gradient: new Float64Array(width), hessian };
  }

  function openSources(constraints: SolverModel["constraints"], phi: Float64Array): string[] {
    const worst = new Map<string, number>();
    let row = 0;
    for (const constraint of constraints) {
      let error = 0;
      for (let k = 0; k < constraint.size; k++) error = Math.max(error, Math.abs(phi[row + k]));
      row += constraint.size;
      if (error > TOLERANCE)
        worst.set(constraint.source, Math.max(worst.get(constraint.source) ?? 0, error));
    }
    return [...worst].sort((x, y) => y[1] - x[1]).map(([source]) => source);
  }

  /** The locks that are in, as the run goes. */
  const engaged = new Set(compiled.locks.filter((lock) => lock.engaged).map((lock) => lock.id));
  /** Whether any lock draws its joint in before it drops. */
  const catching = compiled.locks.some((lock) => lock.catch !== undefined);

  // How far the whole model reaches, for the pace of a body that is let go.
  let span = size;
  for (const body of compiled.bodies.values()) {
    if (body.index < 0) {
      for (const { u, v } of body.points.values()) span = Math.max(span, Math.hypot(u, v));
      continue;
    }
    const at = 3 * body.index;
    span = Math.max(span, Math.hypot(model.q0[at], model.q0[at + 1]) + reach[body.index]);
  }

  /**
   * One sample: from the guess, step until the joints close, nothing overlaps and
   * nothing moves. `since` is the time of the sample before it.
   */
  function attempt(
    previous: Float64Array,
    guess: Float64Array,
    t: number,
    since: number,
    iterations = MAX_ITERATIONS,
  ): Attempt {
    const q = Float64Array.from(guess);
    const now = modelAt(t);
    // The bodies let go in this sample, pulled or not. Each may go only so far in it,
    // whichever way and whatever takes it there: its pull, a spring, or another part.
    // So one that nothing holds moves on evenly, and one that a spring brings back
    // is seen to come back, not found there all at once.
    const pulls = moves.flatMap((move) => {
      const stage = stageAt(move, t)?.stage;
      if (stage?.kind !== "pull") return [];
      const most = (FREE_PACE * span * (t - since)) / stage.time;
      return [{ move, stage, at: 3 * move.body, most }];
    });
    const limit = ({ move, at, most }: (typeof pulls)[number]): Inequality[] =>
      [0, 1, 2].flatMap((k) => {
        // A turn counts as the way it carries the far end of the body.
        const room = k === 2 ? most / (reach[move.body] || size) : most;
        return [1, -1].map((way): Inequality => {
          const gradient = new Float64Array(width);
          gradient[at + k] = -way;
          return {
            source: move.id,
            kind: "limit",
            value: room - way * (q[at + k] - previous[at + k]),
            gradient,
          };
        });
      });
    let limited: string[] = [];
    let stepped = Number.POSITIVE_INFINITY;
    /** How many steps have been taken only to clear the parts; none until the others are spent. */
    let clearing = 0;
    for (let iteration = 0; ; iteration++) {
      const phi = residual(now, q, t);
      const rows = [
        ...contactInequalities(compiled, q),
        ...stopInequalities(compiled.stops, q),
        ...lockInequalities(compiled.locks, engaged, q),
        ...pulls.flatMap(limit),
      ];
      const closed = phi.every((value) => Math.abs(value) < TOLERANCE);
      if (closed && stepped < SETTLED * size && rows.every((row) => row.value > -PENETRATION))
        return { ok: true, q, limited };
      const failed = (): Attempt => ({
        ok: false,
        rows: rows.filter((row) => row.kind !== "limit" && row.value < TOUCHING),
        open: openSources(now.constraints, phi),
      });
      // Parts that have not come to rest in so many steps have not jammed while the
      // joints hold and nothing is (more than a hair) into anything else: a spring may
      // still be carrying them along, or they may be going back and forth where two
      // corners meet. The next sample takes them on from here. Only where no step can
      // be found do they jam.
      // Where the steps go back and forth with the parts a hair too far into each other, a
      // few more take them out, as little as they can; where they cannot, the parts jam.
      if (clearing > 0) {
        if (closed && rows.every((row) => row.value > -PENETRATION))
          return { ok: true, q, limited };
        if (clearing > MAX_CLEARING) return failed();
        clearing++;
      } else if (iteration >= iterations) {
        if (closed && rows.every((row) => row.value > -UNSETTLED_PENETRATION))
          return { ok: true, q, limited };
        clearing = 1;
      }

      // The joints leave some directions free; the step that closes them is core's own.
      const decomposition = svd(jacobian(now, q));
      const closing = pinvSolve(
        decomposition,
        phi.map((value) => -value),
      );
      const free = nullSpace(decomposition);
      const n = free.cols;
      // The energy as the program sees it from here: its slope and its curvature. A step
      // that only clears the parts costs by how far it moves them, and nothing else.
      const { gradient: slope, hessian } =
        clearing > 0 ? movedTerms() : springTerms(compiled.springs, q);
      if (clearing === 0) {
        for (let i = 0; i < width; i++) {
          hessian.data[i * width + i] += eps * weight[i];
          slope[i] += eps * weight[i] * (q[i] - previous[i]);
        }
        // So is the pin of a lock that is drawing its joint in.
        const caught = catchTerms(compiled.locks, engaged, q).gradient;
        for (let i = 0; i < width; i++) slope[i] += caught[i] as number;
        // A pull is energy that falls as the body goes its way.
        for (const { stage, at } of pulls) {
          slope[at] -= stage.force[0];
          slope[at + 1] -= stage.force[1];
        }
      }
      limited = [];
      let dq = closing;
      if (n > 0) {
        // The same program in the free directions only: dq = dq0 + N z.
        const { normals } = linearizeInequalities(rows, width);
        const reduced = mat(n, n);
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
            for (let k = 0; k < n; k++) sides.data[r * n + k] += g * free.data[j * n + k];
          }
        }
        // The rows are flat, as the parts touch now, and a face holds as if it had no
        // end. Where the whole closing step cannot be taken past them, part of it is:
        // from where that leads, the rows are laid out anew.
        let solved: ReturnType<typeof solveQp>;
        for (let part = 1; ; part /= 2) {
          dq = closing.map((value) => part * value);
          const linear = new Float64Array(n);
          const wanted = new Float64Array(rows.length);
          for (let i = 0; i < width; i++) {
            // What the closing step already costs.
            let cost = slope[i];
            for (let j = 0; j < width; j++) cost += hessian.data[i * width + j] * dq[j];
            for (let k = 0; k < n; k++) linear[k] += free.data[i * n + k] * cost;
          }
          rows.forEach((row, r) => {
            wanted[r] = -row.value;
            for (let j = 0; j < width; j++) wanted[r] -= normals.data[r * width + j] * dq[j];
          });
          solved = solveQp(reduced, linear, sides, wanted);
          if (solved || part < LEAST_PART) break;
        }
        if (!solved) return failed();
        limited = solved.active
          .map((r) => rows[r] as Inequality)
          .filter((row) => row.kind === "limit")
          .map((row) => row.source);
        for (let i = 0; i < width; i++) {
          for (let k = 0; k < n; k++) dq[i] += free.data[i * n + k] * solved.x[k];
        }
      }

      // A step is laid out for the parts as they touch now. One that carries a body
      // further than it may go in a sample is cut short, so that it meets what is in its way.
      const far = travel((i) => dq[i]);
      let scale = 1 / Math.max(1, far);
      // And for the springs as they pull now. A spring's pull turns as its ends move,
      // which the step does not know; where the energy does not follow what the step
      // expects of it, the step is halved.
      const near =
        phi.every((value) => Math.abs(value) < NEARLY) && rows.every((row) => row.value > -NEARLY);
      if (near && clearing === 0 && (compiled.springs.length > 0 || pulls.length > 0 || catching)) {
        let along = 0;
        let curved = 0;
        for (let i = 0; i < width; i++) {
          along += slope[i] * dq[i];
          for (let j = 0; j < width; j++) curved += dq[i] * hessian.data[i * width + j] * dq[j];
        }
        const trial = new Float64Array(width);
        const energy = (by: number): number => {
          let held = 0;
          for (let i = 0; i < width; i++) {
            trial[i] = q[i] + by * dq[i];
            held += weight[i] * (trial[i] - previous[i]) ** 2;
          }
          let pulled = 0;
          for (const { stage, at } of pulls)
            pulled += stage.force[0] * trial[at] + stage.force[1] * trial[at + 1];
          return (
            springTerms(compiled.springs, trial).energy +
            catchTerms(compiled.locks, engaged, trial).energy +
            (eps / 2) * held -
            pulled
          );
        };
        const now = energy(0);
        for (let halved = 0; halved < 40; halved++) {
          // Down by at least a tenth of what is expected; or, where the joints and
          // contacts force it up, by no more than nearly twice that.
          const expected = scale * along + 0.5 * scale * scale * curved;
          if (energy(scale) - now <= expected + 0.9 * Math.abs(expected) + 1e-12 * Math.abs(now))
            break;
          scale /= 2;
        }
      }
      stepped = 0;
      for (let i = 0; i < width; i++) {
        q[i] += scale * dq[i];
        stepped += weight[i] * (scale * dq[i]) ** 2;
      }
      stepped = Math.sqrt(stepped);
    }
  }

  /** What one sample's parts carry, by the names of `Loads`. */
  interface Carried {
    contacts: Map<string, number>;
    springs: Map<string, number>;
    stops: Map<string, number>;
    locks: Map<string, number>;
    drivers: Map<string, [x: number, y: number, torque: number]>;
  }

  /**
   * The forces at a solved sample, from the balance of every body: what the springs
   * and pulls ask for is carried by the joints, the drivers and the rows that touch,
   * and a row can only push. The resistance to being moved is no force and is left out.
   */
  function carried(t: number, q: Float64Array): Carried {
    const now = modelAt(t);
    const { gradient: asked } = springTerms(compiled.springs, q);
    const caught = catchTerms(compiled.locks, engaged, q).gradient;
    for (let i = 0; i < width; i++) asked[i] += caught[i] as number;
    const drivers: Carried["drivers"] = new Map();
    for (const move of moves) {
      const stage = stageAt(move, t)?.stage;
      if (stage?.kind !== "pull") continue;
      asked[3 * move.body] -= stage.force[0];
      asked[3 * move.body + 1] -= stage.force[1];
      // In a pull the driver puts on the body just what the stage says.
      drivers.set(move.id, [stage.force[0], stage.force[1], 0]);
    }
    const rows = [
      ...contactInequalities(compiled, q),
      ...stopInequalities(compiled.stops, q),
      ...lockInequalities(compiled.locks, engaged, q),
    ].filter((row) => row.value < TOUCHING);

    // The rows' share is found in the directions the joints leave free, where they
    // alone can answer. Where balance does not settle how the places of one face
    // share its force, they get the least forces that hold.
    const jac = jacobian(now, q);
    const free = nullSpace(svd(jac));
    const n = free.cols;
    const m = rows.length;
    const pushes = new Float64Array(m);
    if (n > 0 && m > 0) {
      const across = new Float64Array(n * m);
      const wanted = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < width; i++) {
          const along = free.data[i * n + k];
          if (along === 0) continue;
          wanted[k] += along * asked[i];
          rows.forEach((row, r) => {
            across[k * m + r] += along * (row.gradient[i] as number);
          });
        }
      }
      const normal = mat(m, m);
      const linear = new Float64Array(m);
      let largest = 0;
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) {
          let sum = 0;
          for (let k = 0; k < n; k++) sum += across[k * m + r] * across[k * m + c];
          normal.data[r * m + c] = sum;
        }
        for (let k = 0; k < n; k++) linear[r] -= across[k * m + r] * wanted[k];
        largest = Math.max(largest, normal.data[r * m + r]);
      }
      const identity = mat(m, m);
      for (let r = 0; r < m; r++) {
        normal.data[r * m + r] += 1e-9 * largest + 1e-12;
        identity.data[r * m + r] = 1;
      }
      const solved = solveQp(normal, linear, identity, new Float64Array(m));
      if (solved) pushes.set(solved.x.map((value) => Math.max(0, value)));
    }
    const greatest = pushes.reduce((most, value) => Math.max(most, value), 0);

    const found: Carried = {
      contacts: new Map(),
      springs: new Map(),
      stops: new Map(),
      locks: new Map(),
      drivers,
    };
    rows.forEach((row, r) => {
      const push = pushes[r] > NO_FORCE * greatest ? pushes[r] : 0;
      const into =
        row.kind === "contact" ? found.contacts : row.kind === "stop" ? found.stops : found.locks;
      into.set(row.source, (into.get(row.source) ?? 0) + push);
      for (let i = 0; i < width; i++) asked[i] -= push * (row.gradient[i] as number);
    });
    for (const spring of compiled.springs) {
      const stretch = springValue(spring, q) - spring.rest;
      found.springs.set(
        spring.id,
        spring.stiffness * (spring.kind === "torsion" ? -stretch : stretch),
      );
    }

    // What is left is for the joints and the drivers that hold: J' lambda = the rest.
    const turned: Mat = mat(width, jac.rows);
    for (let r = 0; r < jac.rows; r++) {
      for (let i = 0; i < width; i++) turned.data[i * jac.rows + r] = jac.data[r * width + i];
    }
    const held = jac.rows > 0 ? pinvSolve(svd(turned), asked) : new Float64Array(0);
    let row = 0;
    for (const constraint of now.constraints) {
      if (constraint.driver) {
        drivers.set(
          constraint.source,
          constraint.size === 3 ? [held[row], held[row + 1], held[row + 2]] : [0, 0, held[row]],
        );
      }
      row += constraint.size;
    }
    return found;
  }

  const times: number[] = [];
  const samples: Float64Array[] = [];
  const carrying: Carried[] = [];
  /** The locks that are in at each sample. */
  const locked: ReadonlySet<string>[] = [];

  /**
   * Keep a solved sample. A lock whose joint has passed its place since the sample
   * before, going the way it drops, is in from the next sample on.
   */
  function keep(t: number, q: Float64Array): void {
    const last = samples[samples.length - 1];
    times.push(t);
    samples.push(q);
    locked.push(new Set(engaged));
    carrying.push(carried(t, q));
    if (!last) return;
    for (const lock of compiled.locks) {
      if (engaged.has(lock.id)) continue;
      const was = jointValue(lock.value, last);
      const is = jointValue(lock.value, q);
      if (lock.drops === "down" ? was >= lock.at && is < lock.at : was <= lock.at && is > lock.at)
        engaged.add(lock.id);
    }
  }
  const free: QuasistaticRun["free"] = [];
  /** The pulls that something held in at least one sample, each as its move and stage. */
  const held = new Set<string>();
  let jam: Jam | undefined;

  /** The sample at `t`, from the last one; split in two where that fails or moves too far. */
  function advance(t: number, splits: number): boolean {
    const last = samples[samples.length - 1] as Float64Array;
    const from = times[times.length - 1] as number;
    // Each sample starts from the one before, not from where the bodies seemed to be
    // going: a part that has just been let go would be carried past where it comes to rest.
    const result = attempt(last, last, t, from);
    const reached = result.ok ? result.q : last;
    if (result.ok && (splits >= MAX_SPLITS || travel((i) => reached[i] - last[i]) <= 1)) {
      keep(t, result.q);
      for (const [m, move] of moves.entries()) {
        const now = stageAt(move, t);
        if (now?.stage.kind === "pull" && !result.limited.includes(move.id))
          held.add(`${m}:${now.index}`);
      }
      return true;
    }
    if (splits >= MAX_SPLITS) {
      if (!result.ok) jam = { time: t, rows: result.rows, open: result.open };
      return false;
    }
    return advance((from + t) / 2, splits + 1) && advance(t, splits + 1);
  }

  // The samples are spread over the stages by their time, each stage's end among them.
  const ends = [...new Set([...moves.flatMap(stageEnds), duration])]
    .filter((end) => end > 0 && end <= duration)
    .sort((x, y) => x - y);
  const counts = ends.map((end, i) =>
    Math.max(1, Math.round((intervals * (end - (ends[i - 1] ?? 0))) / duration)),
  );
  const asked = intervals > 0 ? counts.reduce((sum, count) => sum + count, 1) : 1;

  // The joints close from the starting pose as in mekasim; then the springs and contacts settle.
  const start = Float64Array.from(model.q0);
  const assembled = solvePosition(modelAt(0), start, 0, 200);
  if (!assembled.ok) {
    const none = new Float64Array(0);
    return {
      cycle: {
        steps: asked,
        count: 0,
        width,
        t: none,
        q: none,
        qd: none,
        qdd: none,
        failure: { step: 0, time: 0, open: assembled.open },
      },
      free,
      latched: {},
      loads: { contacts: {}, springs: {}, stops: {}, locks: {}, drivers: {} },
    };
  }
  // A lock that is not said to be in or out is in where its joint starts beyond its place.
  for (const lock of compiled.locks) {
    if (lock.engaged !== undefined) continue;
    const value = jointValue(lock.value, start);
    if (lock.drops === "down" ? value < lock.at : value > lock.at) engaged.add(lock.id);
  }
  const settled = attempt(start, start, 0, 0, MAX_SETTLING);
  keep(0, settled.ok ? settled.q : start);
  if (!settled.ok) jam = { time: 0, rows: settled.rows, open: settled.open };

  let begun = 0;
  run: for (const [i, end] of (intervals > 0 && !jam ? ends : []).entries()) {
    const count = counts[i] as number;
    for (let k = 1; k <= count; k++) {
      if (!advance(k === count ? end : begun + (k * (end - begun)) / count, 0)) break run;
    }
    // Where a pull has taken its body is where the next stage begins.
    const reached = samples[samples.length - 1] as Float64Array;
    for (const [m, move] of moves.entries()) {
      const index = stageEnds(move).indexOf(end);
      if (move.stages[index]?.kind !== "pull") continue;
      const at = 3 * move.body;
      const pose = { x: reached[at], y: reached[at + 1], angle: reached[at + 2] };
      // What follows it until the next `to` begins there too.
      for (let next = index + 1; next <= move.stages.length; next++) {
        (starts[m] as ReturnType<typeof plannedStarts>)[next] = pose;
        if (move.stages[next]?.kind !== "pull") break;
      }
      if (!held.has(`${m}:${index}`)) free.push({ driver: move.id, time: end });
    }
    begun = end;
  }
  const latched = Object.fromEntries(
    compiled.locks.map((lock) => [
      lock.id,
      Float64Array.from(locked, (inNow) => (inNow.has(lock.id) ? 1 : 0)),
    ]),
  );
  const over = (ids: string[], of: (sample: Carried) => Map<string, number>) =>
    Object.fromEntries(
      ids.map((id) => [id, Float64Array.from(carrying, (sample) => of(sample).get(id) ?? 0)]),
    );
  const part = (id: string, k: 0 | 1 | 2) =>
    Float64Array.from(carrying, (sample) => sample.drivers.get(id)?.[k] ?? 0);
  const loads: Loads = {
    contacts: over(
      [...new Set(compiled.contacts.map(({ id }) => id))],
      (sample) => sample.contacts,
    ),
    springs: over(
      compiled.springs.map(({ id }) => id),
      (sample) => sample.springs,
    ),
    stops: over(
      compiled.stops.map(({ joint }) => joint),
      (sample) => sample.stops,
    ),
    locks: over(
      compiled.locks.map(({ id }) => id),
      (sample) => sample.locks,
    ),
    drivers: Object.fromEntries(
      model.constraints
        .filter((constraint) => constraint.driver)
        .map(({ source }) => [
          source,
          { x: part(source, 0), y: part(source, 1), torque: part(source, 2) },
        ]),
    ),
  };
  return {
    cycle: cycleFromPositions(times, samples, Math.max(asked, samples.length)),
    jam,
    free,
    latched,
    loads,
  };
}
