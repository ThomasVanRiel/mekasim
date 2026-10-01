import {
  addBody,
  addDriver,
  addMeasure,
  addPoint,
  addRevolute,
  type BodyPoint,
  docFactor,
  dragTo,
  driversOf,
  findRevolute,
  GROUND,
  LENGTH,
  movePoint,
  removeBody,
  removeJoint,
  removePoint,
  setPose,
  toggleTrace,
} from "@mekasim/core";
import { type DraftPoint, LIVE, useStore } from "../store.ts";
import {
  type Hit,
  nearestStep,
  pick,
  pinNear,
  pointsNear,
  toLocal,
  toWorld,
  type WorldPoint,
  worldPoints,
} from "./pick.ts";
import type { Scene } from "./scene.ts";

/**
 * What the drawing tools do, in model terms. The pointer handling turns clicks and
 * drags into calls of these; nothing here knows about the screen.
 * Positions are world coordinates in metres.
 */

/** Metres per document length unit. */
function unit(): number {
  const compiled = useStore.getState().shown?.compiled;
  return compiled ? docFactor(LENGTH, compiled.units) : 0.001;
}

/**
 * Where a click lands: on an existing point when one is within reach, otherwise on
 * the nearest fine grid position (a tenth of a grid square), or exactly where
 * clicked when `free`.
 */
export function snap(
  scene: Scene,
  x: number,
  y: number,
  tolerance: number,
  free = false,
): DraftPoint {
  const { step } = useStore.getState();
  const near = pointsNear(worldPoints(scene, step), x, y, tolerance)[0];
  if (near) return { x: near.x, y: near.y, ref: near.ref };
  if (free) return { x, y };
  const fine = scene.gridStep / 10;
  return { x: Math.round(x / fine) * fine, y: Math.round(y / fine) * fine };
}

/** Ground first, so that joints read `[ground.G1, link1.A]`. */
function ordered(a: string, b: string): [string, string] {
  return b.startsWith(`${GROUND}.`) ? [b, a] : [a, b];
}

/** Add a point to the link being drawn; a second click on the last point finishes it. */
export function clickLink(point: DraftPoint, tolerance: number): void {
  const { draft, setDraft } = useStore.getState();
  const last = draft.at(-1);
  if (last && Math.hypot(point.x - last.x, point.y - last.y) <= tolerance) {
    finishLink();
    return;
  }
  setDraft([...draft, point]);
}

/** Turn the points placed so far into a link, pinned wherever it was placed on existing points. */
export function finishLink(): void {
  const state = useStore.getState();
  const { draft } = state;
  if (draft.length < 2) {
    state.setNotice(
      "A link needs at least two points. Click another place, or press Esc to cancel.",
    );
    return;
  }
  const scale = unit();
  let created: string | undefined;
  const done = state.transact((tx) => {
    const body = addBody(
      tx.doc,
      draft.map((p) => [p.x / scale, p.y / scale]),
    );
    tx.run(body.edits);
    created = body.id;
    draft.forEach((p, i) => {
      if (p.ref)
        tx.run(addRevolute(tx.doc, ...ordered(p.ref, `${body.id}.${body.names[i]}`)).edits);
    });
  });
  if (!done) return;
  state.setDraft([]);
  if (created) state.select({ kind: "body", id: created });
}

/** Pin together the links that meet at a place, or pin a lone point to the ground. */
export function clickPin(scene: Scene, x: number, y: number, tolerance: number): void {
  const state = useStore.getState();
  const near = pointsNear(worldPoints(scene, state.step), x, y, tolerance);
  const first = near.find((p) => p.body !== GROUND) ?? near[0];
  if (!first) {
    state.setNotice("There is no point here. Click on a point of a link.");
    return;
  }
  const scale = unit();
  state.transact((tx) => {
    const others = near.filter((p) => p.body !== first.body);
    const partner = others.find((p) => !findRevolute(tx.doc, first.ref, p.ref));
    if (partner) {
      const joint = addRevolute(tx.doc, ...ordered(first.ref, partner.ref));
      tx.run(joint.edits);
      useStore.getState().select({ kind: "joint", id: joint.id });
    } else if (others.length > 0) {
      state.setNotice("The points here are already pinned together.");
    } else if (first.body === GROUND) {
      state.setNotice("Only the ground has a point here. Click where a link has one.");
    } else {
      // Nothing else is here, so fix the point in place.
      const ground = addPoint(tx.doc, GROUND, [first.x / scale, first.y / scale]);
      tx.run(ground.edits);
      const joint = addRevolute(tx.doc, `${GROUND}.${ground.name}`, first.ref);
      tx.run(joint.edits);
      useStore.getState().select({ kind: "joint", id: joint.id });
    }
  });
}

/** Drive the pin at a place, or stop driving it. */
export function clickMotor(scene: Scene, x: number, y: number, tolerance: number): void {
  const state = useStore.getState();
  const pin = pinNear(scene, state.step, x, y, tolerance);
  if (pin?.kind !== "revolute") {
    state.setNotice("A motor turns a pin. Click on one.");
    return;
  }
  state.transact((tx) => {
    const drivers = driversOf(tx.doc, pin.id);
    if (drivers.length > 0) tx.run(drivers.map((id) => ({ op: "delete", path: ["drivers", id] })));
    else tx.run(addDriver(tx.doc, pin.id).edits);
  });
  useStore.getState().select({ kind: "joint", id: pin.id });
}

/** Record the path of the point at a place, or stop recording it. */
export function clickTrace(scene: Scene, x: number, y: number, tolerance: number): void {
  const state = useStore.getState();
  const point = pointsNear(worldPoints(scene, state.step), x, y, tolerance).find(
    (p) => p.body !== GROUND,
  );
  if (!point) {
    state.setNotice("Click on a point of a link to record its path.");
    return;
  }
  state.transact((tx) => tx.run(toggleTrace(tx.doc, point.ref)));
}

/**
 * Measure on the drawing: two points give the distance between them, a link clicked
 * away from its points gives its angle. The result is added to the model's measures.
 */
export function clickMeasure(scene: Scene, x: number, y: number, tolerance: number): void {
  const state = useStore.getState();
  const [first] = state.draft;
  const point = pointsNear(worldPoints(scene, state.step), x, y, tolerance)[0];

  if (point && !first) {
    state.setDraft([{ x: point.x, y: point.y, ref: point.ref }]);
    state.setNotice(undefined);
    return;
  }
  if (point && first?.ref) {
    if (point.ref === first.ref) {
      state.setNotice("That is the same point. Click a different one to measure the distance.");
      return;
    }
    const from = first.ref;
    state.transact((tx) => tx.run(addMeasure(tx.doc, "dist", `dist(${from}, ${point.ref})`).edits));
    state.setDraft([]);
    return;
  }
  const hit = first ? undefined : pick(scene, state.step, x, y, tolerance);
  if (hit?.kind === "body") {
    state.transact((tx) => tx.run(addMeasure(tx.doc, "angle", `angle(${hit.id})`).edits));
    return;
  }
  state.setNotice(
    first
      ? "Click a second point to measure the distance to it."
      : "Click a point to start a distance, or a link to measure its angle.",
  );
}

/** The points that move as one when a point is reshaped: it, and those pinned to it. */
export interface Reshape {
  points: WorldPoint[];
}

export function startReshape(
  scene: Scene,
  x: number,
  y: number,
  tolerance: number,
): Reshape | undefined {
  const state = useStore.getState();
  const all = worldPoints(scene, state.step);
  const picked = pointsNear(all, x, y, tolerance)[0];
  if (!picked) return undefined;

  const refs = new Set([picked.ref]);
  for (let grown = true; grown; ) {
    grown = false;
    for (const pin of scene.pins) {
      if (pin.kind !== "revolute" && pin.kind !== "weld") continue;
      if (pin.refs.some((ref) => refs.has(ref)) && !pin.refs.every((ref) => refs.has(ref))) {
        for (const ref of pin.refs) refs.add(ref);
        grown = true;
      }
    }
  }

  const doc = state.shown?.doc;
  const points = all.filter((p) => refs.has(p.ref));
  const made = points.find((p) => doc?.bodies[p.body]?.points[p.name] === undefined);
  if (made) {
    state.setNotice(
      `${made.ref} belongs to a crank or rod, so it cannot be dragged. Select it and change its values in the inspector.`,
    );
    return undefined;
  }
  const fixed = points.find((p) =>
    doc?.bodies[p.body]?.points[p.name]?.some((coordinate) => typeof coordinate !== "number"),
  );
  if (fixed) {
    state.setNotice(
      `${fixed.ref} is set by an expression, so it cannot be dragged. Change it in the source or the inspector.`,
    );
    return undefined;
  }
  return { points };
}

export function reshapeTo(reshape: Reshape, x: number, y: number): void {
  const state = useStore.getState();
  const { scene } = state;
  if (!scene) return;
  const scale = unit();
  const edits = reshape.points.flatMap((p) => {
    const [u, v] = toLocal(scene, p.index, state.step, x, y);
    return movePoint(p.body, p.name, [u / scale, v / scale]);
  });
  state.apply(edits, LIVE);
}

/** Remove whatever is selected, with everything that depends on it. */
export function deleteSelection(): void {
  const state = useStore.getState();
  const { selection } = state;
  if (!selection) return;
  if (selection.kind === "body" && selection.id === GROUND) {
    state.setNotice("The ground cannot be removed.");
    return;
  }
  const doc = state.simulation.doc;
  // A point or pin that a crank or rod stands for goes only with that component.
  const written =
    selection.kind === "body" ||
    (selection.kind === "joint"
      ? doc?.joints?.[selection.id] !== undefined
      : doc?.bodies[selection.ref.split(".")[0] as string]?.points[
          selection.ref.split(".")[1] as string
        ] !== undefined);
  if (doc && !written) {
    state.setNotice("This belongs to a crank or rod. Select the crank or rod itself to remove it.");
    return;
  }
  const done = state.transact((tx) => {
    if (selection.kind === "body") {
      tx.run(removeBody(tx.doc, selection.id));
      tx.run([{ op: "delete", path: ["components", selection.id] }]);
    } else if (selection.kind === "joint") tx.run(removeJoint(tx.doc, selection.id));
    else {
      const [body, point] = selection.ref.split(".") as [string, string];
      tx.run(removePoint(tx.doc, body, point));
    }
  });
  if (done) state.select(undefined);
}

/** A part held by the pointer. */
export interface Grab {
  /** The held place on a body, in that body's frame. */
  at: BodyPoint;
  /** Scrubbing through the solved cycle of a driven mechanism, or posing a free one. */
  mode: "scrub" | "pose";
  /** Where the held place is at each sample of the cycle, for scrubbing. */
  xs: Float64Array;
  ys: Float64Array;
  /** Positions of all bodies while posing. */
  q: Float64Array;
}

/** Take hold of what was hit, at a world position. Undefined when it cannot be moved. */
export function grab(scene: Scene, hit: Hit, x: number, y: number): Grab | undefined {
  const { shown, step } = useStore.getState();
  const compiled = shown?.compiled;
  if (!compiled) return undefined;

  let at: BodyPoint | undefined;
  if (hit.kind === "body") {
    const body = scene.bodies.find((b) => b.id === hit.id);
    if (body) {
      const [u, v] = toLocal(scene, body.index, step, x, y);
      at = { body: body.index, u, v };
    }
  } else if (hit.kind === "point") {
    const [bodyId, name] = hit.ref.split(".");
    const body = scene.bodies.find((b) => b.id === bodyId);
    const point = body?.points.find((p) => p.name === name);
    if (body && point) at = { body: body.index, u: point.u, v: point.v };
  } else {
    const pin = scene.pins.find((p) => p.id === hit.id);
    if (pin && pin.body >= 0) at = { body: pin.body, u: pin.u, v: pin.v };
  }
  if (!at) return undefined;

  const { cycle } = scene;
  const mode = compiled.drivers.length > 0 && cycle.count > 1 ? "scrub" : "pose";
  const xs = new Float64Array(mode === "scrub" ? cycle.count : 0);
  const ys = new Float64Array(xs.length);
  for (let k = 0; k < xs.length; k++) {
    const [wx, wy] = toWorld(scene, at.body, k, at.u, at.v);
    xs[k] = wx;
    ys[k] = wy;
  }
  const k0 = Math.min(Math.max(Math.floor(step), 0), cycle.count - 1) * cycle.width;
  const q = Float64Array.from(scene.override ?? cycle.q.subarray(k0, k0 + cycle.width));
  return { at, mode, xs, ys, q };
}

/** Move the held part towards a world position. */
export function pull(scene: Scene, held: Grab, x: number, y: number): void {
  const state = useStore.getState();
  if (held.mode === "scrub") {
    state.setPlaying(false);
    state.setStep(nearestStep(held.xs, held.ys, x, y, state.step, scene.periodic));
    return;
  }
  const model = state.shown?.compiled?.model;
  if (!model) return;
  dragTo(model, held.q, held.at, x, y);
  scene.override = held.q;
}

/** Let go. A posed mechanism keeps its new position by having it written into the model. */
export function release(scene: Scene, held: Grab): void {
  if (held.mode !== "pose" || !scene.override) return;
  const state = useStore.getState();
  const compiled = state.shown?.compiled;
  scene.override = undefined;
  if (!compiled) return;
  const scale = unit();
  const angle = compiled.units.angle === "deg" ? 180 / Math.PI : 1;
  const poses: Record<string, [number, number, number]> = {};
  compiled.model.bodies.forEach((id, i) => {
    poses[id] = [held.q[3 * i] / scale, held.q[3 * i + 1] / scale, held.q[3 * i + 2] * angle];
  });
  state.apply(setPose(poses));
}
