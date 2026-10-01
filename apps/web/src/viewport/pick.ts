import { GROUND } from "@mekasim/core";
import { poseAt, type Scene } from "./scene.ts";

/** A named point of the model at its position in the world, in metres. */
export interface WorldPoint {
  /** `body.point` */
  ref: string;
  body: string;
  name: string;
  /** Solver index of the body; -1 for ground. */
  index: number;
  x: number;
  y: number;
}

export type Hit =
  | { kind: "joint"; id: string }
  | { kind: "point"; ref: string }
  | { kind: "body"; id: string };

/** Where a point of a body is in the world at a step of the cycle. */
export function toWorld(
  scene: Scene,
  index: number,
  step: number,
  u: number,
  v: number,
): [number, number] {
  if (index < 0) return [u, v];
  const pose: [number, number, number] = [0, 0, 0];
  poseAt(scene, index, step, pose);
  const c = Math.cos(pose[2]);
  const s = Math.sin(pose[2]);
  return [pose[0] + u * c - v * s, pose[1] + u * s + v * c];
}

/** A world position expressed in the frame of a body at a step of the cycle. */
export function toLocal(
  scene: Scene,
  index: number,
  step: number,
  x: number,
  y: number,
): [number, number] {
  if (index < 0) return [x, y];
  const pose: [number, number, number] = [0, 0, 0];
  poseAt(scene, index, step, pose);
  const c = Math.cos(pose[2]);
  const s = Math.sin(pose[2]);
  const dx = x - pose[0];
  const dy = y - pose[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}

export function worldPoints(scene: Scene, step: number): WorldPoint[] {
  const points: WorldPoint[] = scene.ground.map((p) => ({
    ref: `${GROUND}.${p.name}`,
    body: GROUND,
    name: p.name,
    index: -1,
    x: p.u,
    y: p.v,
  }));
  for (const body of scene.bodies) {
    for (const p of body.points) {
      const [x, y] = toWorld(scene, body.index, step, p.u, p.v);
      points.push({
        ref: `${body.id}.${p.name}`,
        body: body.id,
        name: p.name,
        index: body.index,
        x,
        y,
      });
    }
  }
  return points;
}

/** The points within `tolerance` of a position, nearest first. */
export function pointsNear(
  points: WorldPoint[],
  x: number,
  y: number,
  tolerance: number,
): WorldPoint[] {
  return points
    .map((point) => ({ point, distance: Math.hypot(point.x - x, point.y - y) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ point }) => point);
}

function inside(outline: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i] as [number, number];
    const [xj, yj] = outline[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The pin nearest a position, within `tolerance`. */
export function pinNear(scene: Scene, step: number, x: number, y: number, tolerance: number) {
  let best: { pin: Scene["pins"][number]; distance: number } | undefined;
  for (const pin of scene.pins) {
    const [px, py] = toWorld(scene, pin.body, step, pin.u, pin.v);
    const distance = Math.hypot(px - x, py - y);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { pin, distance };
  }
  return best?.pin;
}

function toSegment(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const along =
    length === 0 ? 0 : Math.min(Math.max(((x - a[0]) * dx + (y - a[1]) * dy) / length, 0), 1);
  return Math.hypot(x - a[0] - along * dx, y - a[1] - along * dy);
}

/**
 * The two straight runs of a belt round two wheels: the lines that touch both
 * wheels on the outside. Each run is given by its two ends.
 */
export function beltRuns(
  a: [number, number],
  ra: number,
  b: [number, number],
  rb: number,
): [[number, number], [number, number]][] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ex = (b[0] - a[0]) / d;
  const ey = (b[1] - a[1]) / d;
  const along = (ra - rb) / d;
  const across = Math.sqrt(Math.max(0, 1 - along * along));
  return [1, -1].map((side) => {
    const mx = along * ex - side * across * ey;
    const my = along * ey + side * across * ex;
    return [
      [a[0] + ra * mx, a[1] + ra * my],
      [b[0] + rb * mx, b[1] + rb * my],
    ];
  });
}

/**
 * The gear, belt, cam or tie drawn at a position: the rim of a wheel, a run of a
 * belt, the line of a tie, the edge of a cam or its follower's roller.
 */
export function drawnJointNear(
  scene: Scene,
  step: number,
  x: number,
  y: number,
  tolerance: number,
): string | undefined {
  for (const wheel of scene.wheels) {
    const [cx, cy] = toWorld(scene, wheel.body, step, wheel.u, wheel.v);
    if (Math.abs(Math.hypot(x - cx, y - cy) - wheel.radius) <= tolerance) return wheel.joint;
  }
  for (const tie of scene.ties) {
    const a = toWorld(scene, tie.a.body, step, tie.a.u, tie.a.v);
    const b = toWorld(scene, tie.b.body, step, tie.b.u, tie.b.v);
    const runs =
      tie.kind === "belt" ? beltRuns(a, tie.a.radius, b, tie.b.radius) : [[a, b] as const];
    if (runs.some(([from, to]) => toSegment(x, y, from, to) <= tolerance)) return tie.id;
  }
  for (const roller of scene.rollers) {
    const [cx, cy] = toWorld(scene, roller.body, step, roller.u, roller.v);
    if (Math.hypot(x - cx, y - cy) <= Math.max(roller.radius, tolerance)) return roller.id;
  }
  for (const cam of scene.cams) {
    const [u, v] = toLocal(scene, cam.body, step, x, y);
    const near = cam.outline.some((corner, i) => {
      const next = cam.outline[(i + 1) % cam.outline.length] as [number, number];
      return toSegment(u, v, corner, next) <= tolerance;
    });
    if (near) return cam.id;
  }
  return undefined;
}

/**
 * What is under a position: a joint before a point before a body, since the smaller
 * things sit on top of the larger. Among bodies the frontmost wins.
 */
export function pick(
  scene: Scene,
  step: number,
  x: number,
  y: number,
  tolerance: number,
): Hit | undefined {
  const pin = pinNear(scene, step, x, y, tolerance);
  if (pin) return { kind: "joint", id: pin.id };

  const point = pointsNear(worldPoints(scene, step), x, y, tolerance)[0];
  if (point) return { kind: "point", ref: point.ref };

  const drawn = drawnJointNear(scene, step, x, y, tolerance);
  if (drawn) return { kind: "joint", id: drawn };

  const front = [...scene.bodies].sort((a, b) => b.z - a.z);
  for (const body of front) {
    const [u, v] = toLocal(scene, body.index, step, x, y);
    if (inside(body.outline, u, v)) return { kind: "body", id: body.id };
  }
  return undefined;
}

/**
 * The sample of the cycle at which a point comes nearest a position, searching
 * outwards from the current step so that a path crossing itself does not make the
 * mechanism jump.
 */
export function nearestStep(
  xs: Float64Array,
  ys: Float64Array,
  x: number,
  y: number,
  current: number,
  periodic: boolean,
): number {
  const count = xs.length;
  const reach = Math.max(2, Math.ceil(count / 6));
  let best = Math.min(Math.max(Math.round(current), 0), count - 1);
  let bestDistance = Math.hypot(xs[best] - x, ys[best] - y);
  for (let offset = -reach; offset <= reach; offset++) {
    let k = Math.round(current) + offset;
    if (periodic) k = ((k % count) + count) % count;
    else if (k < 0 || k >= count) continue;
    const distance = Math.hypot(xs[k] - x, ys[k] - y);
    if (distance < bestDistance) {
      best = k;
      bestDistance = distance;
    }
  }
  return best;
}
