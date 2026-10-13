import type { Constraint, Point, Pose } from "@mekasim/core";

/** A stage that carries the body to a pose: straight, or along the arc through `via`. */
export interface ToStage {
  kind: "to";
  to: Pose;
  via?: Point;
  /** How long the stage takes, in seconds. */
  time: number;
}

/** A stage that lets the body go and pulls it with a force, at the origin of its frame. */
export interface PullStage {
  kind: "pull";
  /** In newtons, along the sheet's x and y. */
  force: Point;
  time: number;
}

export type Stage = ToStage | PullStage;

/** A `move` driver: one body carried through its stages, starting from its pose. */
export interface CompiledMove {
  id: string;
  /** The body as a solver index. */
  body: number;
  start: Pose;
  stages: Stage[];
}

const TURN = 2 * Math.PI;

/** How long all the stages of a move take together, in seconds. */
export function moveDuration(move: CompiledMove): number {
  return move.stages.reduce((sum, stage) => sum + stage.time, 0);
}

/** How far round, anticlockwise, from one direction to another: from 0 up to a full turn. */
function turned(from: number, to: number): number {
  return (((to - from) % TURN) + TURN) % TURN;
}

/** The place a fraction `s` of the way from `from` to `to`, along the arc through `via`. */
function alongVia(from: Pose, via: Point, to: Pose, s: number): Point {
  const ax = via[0] - from.x;
  const ay = via[1] - from.y;
  const bx = to.x - from.x;
  const by = to.y - from.y;
  const cross = ax * by - ay * bx;
  const span = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by));
  // Three places in a line, or two of them the same, have no arc through them.
  if (Math.abs(cross) < 1e-12 * span * span)
    return [from.x + s * (to.x - from.x), from.y + s * (to.y - from.y)];

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const cx = from.x + (by * a2 - ay * b2) / (2 * cross);
  const cy = from.y + (ax * b2 - bx * a2) / (2 * cross);
  const r = Math.hypot(from.x - cx, from.y - cy);
  const start = Math.atan2(from.y - cy, from.x - cx);
  const toVia = turned(start, Math.atan2(via[1] - cy, via[0] - cx));
  const toEnd = turned(start, Math.atan2(to.y - cy, to.x - cx));
  // The way round that passes `via` before it reaches the end.
  const sweep = toVia < toEnd ? toEnd : toEnd - TURN;
  const angle = start + s * sweep;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/** When each stage of a move ends, in seconds from the start of the run. */
export function stageEnds(move: CompiledMove): number[] {
  let at = 0;
  return move.stages.map((stage) => {
    at += stage.time;
    return at;
  });
}

/**
 * Where each stage begins, and last where the move ends, as far as the stages say.
 * Where a pull takes the body is for a run to find; until it has, what follows a pull
 * is put where the pull began.
 */
export function plannedStarts(move: CompiledMove): Pose[] {
  const starts = [move.start];
  for (const stage of move.stages) {
    starts.push(stage.kind === "to" ? stage.to : (starts[starts.length - 1] as Pose));
  }
  return starts;
}

/** The stage a move is in at time `t`: each lasts up to and with its end. None once the last is over. */
export function stageAt(
  move: CompiledMove,
  t: number,
): { index: number; stage: Stage; begun: number } | undefined {
  let begun = 0;
  for (const [index, stage] of move.stages.entries()) {
    if (t <= begun + stage.time) return { index, stage, begun };
    begun += stage.time;
  }
  return undefined;
}

/**
 * Where a move holds its body at time `t`; after its last stage, where that ended.
 * During a pull nothing holds the body, and this is where the pull began.
 */
export function poseAt(move: CompiledMove, t: number, starts = plannedStarts(move)): Pose {
  const now = stageAt(move, t);
  if (!now) return starts[move.stages.length] as Pose;
  const from = starts[now.index] as Pose;
  const { stage } = now;
  if (stage.kind === "pull") return from;
  const s = stage.time > 0 ? Math.min(1, Math.max(0, (t - now.begun) / stage.time)) : 1;
  const [x, y] = stage.via
    ? alongVia(from, stage.via, stage.to, s)
    : [from.x + s * (stage.to.x - from.x), from.y + s * (stage.to.y - from.y)];
  return { x, y, angle: from.angle + s * (stage.to.angle - from.angle) };
}

/**
 * The three equations that hold a moved body at its pose for the time. `starts` is
 * where its stages begin, which a run fills in as it finds where each pull ends.
 */
export function moveConstraint(move: CompiledMove, starts = plannedStarts(move)): Constraint {
  const at = 3 * move.body;
  return {
    source: move.id,
    driver: true,
    size: 3,
    residual(q, t, out, row) {
      const pose = poseAt(move, t, starts);
      out[row] = q[at] - pose.x;
      out[row + 1] = q[at + 1] - pose.y;
      out[row + 2] = q[at + 2] - pose.angle;
    },
    jacobian(_q, jac, row) {
      for (let k = 0; k < 3; k++) jac.data[(row + k) * jac.cols + at + k] += 1;
    },
    // A contact run takes its velocities from the sampled positions, not from these.
    velocityRhs(out, row) {
      out.fill(0, row, row + 3);
    },
    accelerationRhs(_q, _qd, out, row) {
      out.fill(0, row, row + 3);
    },
  };
}
