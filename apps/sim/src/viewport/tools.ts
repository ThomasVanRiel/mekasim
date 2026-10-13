import {
  addBody,
  addComponent,
  addDriver,
  addJoint,
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
  nameMeasure,
  removeBody,
  removeJoint,
  removePoint,
  setPose,
  tidy,
  toggleTrace,
} from "@mekasim/core";
import type { Scene } from "@mekasim/ui";
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

/** The link point at a place, leaving out the ground's own points. */
function linkPointAt(
  scene: Scene,
  x: number,
  y: number,
  tolerance: number,
): WorldPoint | undefined {
  const { step } = useStore.getState();
  return pointsNear(worldPoints(scene, step), x, y, tolerance).find((p) => p.body !== GROUND);
}

/**
 * The first of a tool's two clicks: remember the point and wait for the second.
 * Returns the remembered point on the second click.
 */
function second(point: DraftPoint): DraftPoint | undefined {
  const state = useStore.getState();
  const [first] = state.draft;
  if (!first) {
    state.setDraft([point]);
    state.setNotice(undefined);
    return undefined;
  }
  return first;
}

/**
 * Draw a crank: the first click is where it pivots, the second the end of its arm.
 * A pivot placed on an existing point turns about that point; an arm end placed on
 * one is pinned to it.
 */
export function clickCrank(point: DraftPoint, tolerance: number): void {
  const pivot = second(point);
  if (!pivot) return;
  const state = useStore.getState();
  const radius = Math.hypot(point.x - pivot.x, point.y - pivot.y);
  if (radius <= tolerance) {
    state.setNotice("Click away from the pivot to give the arm its length.");
    return;
  }
  const scale = unit();
  const degrees = state.shown?.compiled?.units.angle !== "rad";
  const angle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
  let created: string | undefined;
  const done = state.transact((tx) => {
    const crank = addComponent(tx.doc, "crank", {
      type: "crank",
      at: pivot.ref ?? [tidy(pivot.x / scale), tidy(pivot.y / scale)],
      arms: { A: [tidy(radius / scale), tidy(degrees ? (angle * 180) / Math.PI : angle)] },
    });
    tx.run(crank.edits);
    created = crank.id;
    if (point.ref) tx.run(addRevolute(tx.doc, ...ordered(point.ref, `${crank.id}.A`)).edits);
  });
  if (!done) return;
  state.setDraft([]);
  if (created) state.select({ kind: "body", id: created });
}

/** Draw a rod between two existing points: a link given by its length. */
export function clickRod(scene: Scene, x: number, y: number, tolerance: number): void {
  const state = useStore.getState();
  const at = pointsNear(worldPoints(scene, state.step), x, y, tolerance)[0];
  if (!at) {
    state.setNotice("A rod runs between two existing points. Click on a point.");
    return;
  }
  const from = second({ x: at.x, y: at.y, ref: at.ref });
  if (!from?.ref) return;
  if (from.ref.split(".")[0] === at.body) {
    state.setNotice("Both ends are on the same body. Click a point of another one.");
    return;
  }
  const start = from.ref;
  const length = Math.hypot(at.x - from.x, at.y - from.y);
  let created: string | undefined;
  const done = state.transact((tx) => {
    const rod = addComponent(tx.doc, "rod", {
      type: "rod",
      length: tidy(length / unit()),
      connect: [start, at.ref],
    });
    tx.run(rod.edits);
    created = rod.id;
  });
  if (!done) return;
  state.setDraft([]);
  if (created) state.select({ kind: "body", id: created });
}

/**
 * Guide a point along a straight line: the first click picks the point, the second
 * gives the direction of the line, which is fixed to the ground.
 */
export function clickSlot(scene: Scene, point: DraftPoint, tolerance: number): void {
  const state = useStore.getState();
  if (state.draft.length === 0) {
    const pin = linkPointAt(scene, point.x, point.y, tolerance);
    if (!pin) {
      state.setNotice("Click the point of a link that should slide along a line.");
      return;
    }
    second({ x: pin.x, y: pin.y, ref: pin.ref });
    return;
  }
  const pin = second(point);
  if (!pin?.ref) return;
  if (Math.hypot(point.x - pin.x, point.y - pin.y) <= tolerance) {
    state.setNotice("Click away from the point to give the direction of the line.");
    return;
  }
  const guided = pin.ref;
  const scale = unit();
  let created: string | undefined;
  const done = state.transact((tx) => {
    const from = addPoint(tx.doc, GROUND, [pin.x / scale, pin.y / scale]);
    tx.run(from.edits);
    const to = addPoint(tx.doc, GROUND, [point.x / scale, point.y / scale]);
    tx.run(to.edits);
    const slot = addJoint(tx.doc, "slot", {
      type: "pin-slot",
      axis: [`${GROUND}.${from.name}`, `${GROUND}.${to.name}`],
      point: guided,
    });
    tx.run(slot.edits);
    created = slot.id;
  });
  if (!done) return;
  state.setDraft([]);
  if (created) state.select({ kind: "joint", id: created });
}

/** A joint between two clicked link points on different bodies. */
function joinTwo(
  scene: Scene,
  x: number,
  y: number,
  tolerance: number,
  ask: string,
  build: (from: DraftPoint & { ref: string }, to: WorldPoint) => Parameters<typeof addJoint>[2],
  base: string,
): void {
  const state = useStore.getState();
  const at = linkPointAt(scene, x, y, tolerance);
  if (!at) {
    state.setNotice(ask);
    return;
  }
  const from = second({ x: at.x, y: at.y, ref: at.ref });
  if (!from?.ref) return;
  if (from.ref.split(".")[0] === at.body) {
    state.setNotice("Both are on the same body. Click a point of another one.");
    return;
  }
  const first = { ...from, ref: from.ref };
  let created: string | undefined;
  const done = state.transact((tx) => {
    const joint = addJoint(tx.doc, base, build(first, at));
    tx.run(joint.edits);
    created = joint.id;
  });
  if (!done) return;
  state.setDraft([]);
  if (created) state.select({ kind: "joint", id: created });
}

/** Keep two points a fixed distance apart, at the distance they are now. */
export function clickTie(scene: Scene, x: number, y: number, tolerance: number): void {
  joinTwo(
    scene,
    x,
    y,
    tolerance,
    "A tie holds two points a fixed distance apart. Click a point of a link.",
    (from, to) => ({
      type: "distance",
      connect: [from.ref, to.ref],
      length: tidy(Math.hypot(to.x - from.x, to.y - from.y) / unit()),
    }),
    "tie",
  );
}

/** Gear two turning bodies together, by clicking the centre each turns about. */
export function clickGear(scene: Scene, x: number, y: number, tolerance: number): void {
  joinTwo(
    scene,
    x,
    y,
    tolerance,
    "Click the centre each wheel turns about: the pivot point of a crank or link.",
    (from, to) => ({ type: "gear", connect: [from.ref, to.ref], sizes: [20, 20] }),
    "gear",
  );
}

/**
 * Put a cam between two bodies: the first click is the cam's centre, the second the
 * follower's point. It starts with a simple rise and fall, to be shaped in the inspector.
 */
export function clickCam(scene: Scene, x: number, y: number, tolerance: number): void {
  joinTwo(
    scene,
    x,
    y,
    tolerance,
    "Click the centre of the cam on its body, then the point of the follower that rides on it.",
    (from, to) => {
      const base = Math.hypot(to.x - from.x, to.y - from.y) / unit();
      const lift = tidy(base * 0.3);
      return {
        type: "cam",
        cam: from.ref,
        follower: to.ref,
        base: tidy(base),
        profile: [
          [0, 0],
          [120, lift],
          [180, lift],
          [300, 0],
        ],
      };
    },
    "cam",
  );
}

/**
 * The measures that say how a link has moved from where it started: how far its
 * centre has gone each way and in all, and how far it has turned.
 */
export function linkMeasures(id: string): [name: string, expr: string][] {
  return [
    [`${id}_dx`, `change(x(${id}))`],
    [`${id}_dy`, `change(y(${id}))`],
    [`${id}_moved`, `moved(${id})`],
    [`${id}_turn`, `change(angle(${id}))`],
  ];
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
    // A link is measured by how far its centre has moved and how far it has turned.
    state.transact((tx) => {
      for (const [name, expr] of linkMeasures(hit.id)) tx.run(nameMeasure(tx.doc, name, expr));
    });
    return;
  }
  state.setNotice(
    first
      ? "Click a second point to measure the distance to it."
      : "Click a point to start a distance, or a link to measure how far it has moved and turned.",
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
