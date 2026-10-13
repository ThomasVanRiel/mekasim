import { type Document, GROUND } from "../schema/document.ts";
import { applyEdits, type Edit, type Value } from "./patch.ts";

/** The usual order of the top-level sections of a model. */
export const SECTION_ORDER = [
  "mekasim",
  "meta",
  "params",
  "geometry",
  "bodies",
  "components",
  "joints",
  "drivers",
  "traces",
  "frames",
  "measures",
  "checks",
  "plots",
  "fabrication",
  "cycle",
  "pose",
];

/** Apply changes to model text, leaving the rest of the text as written. */
export function editText(text: string, edits: Edit[]): string {
  return applyEdits(text, edits, SECTION_ORDER);
}

export const NEW_MODEL = `mekasim: 1
meta:
  name: Untitled model

bodies: {}
`;

/** A position in document units. */
export type Coord = [x: number, y: number];

/** Round away the noise of a mouse position; a thousandth of a document unit is kept. */
export function tidy(value: number): number {
  const rounded = Number(value.toFixed(3));
  return rounded === 0 ? 0 : rounded;
}

function tidyCoord(at: Coord): Coord {
  return [tidy(at[0]), tidy(at[1])];
}

/** `base1`, `base2`, ...: the first that is not taken. */
export function freeName(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    if (!used.has(`${base}${n}`)) return `${base}${n}`;
  }
}

/** `A`, `B`, ... `Z`, then `A1`, `B1`, ...: the first that is not taken. */
export function freePointName(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let round = 0; ; round++) {
    for (let letter = 0; letter < 26; letter++) {
      const name = String.fromCharCode(65 + letter) + (round === 0 ? "" : round);
      if (!used.has(name)) return name;
    }
  }
}

function bodyOf(ref: string): string {
  return ref.split(".")[0] as string;
}

/** The points a joint refers to, each as `body.point`. */
export function jointRefs(joint: NonNullable<Document["joints"]>[string]): string[] {
  if ("connect" in joint) return [...joint.connect];
  return "axis" in joint ? [...joint.axis, joint.point] : [joint.cam, joint.follower];
}

export function addBody(
  doc: Document,
  points: Coord[],
): { id: string; names: string[]; edits: Edit[] } {
  const id = freeName(Object.keys(doc.bodies), "link");
  const names: string[] = [];
  const entries: Record<string, Coord> = {};
  for (const at of points) {
    const name = freePointName(names);
    names.push(name);
    entries[name] = tidyCoord(at);
  }
  return {
    id,
    names,
    edits: [{ op: "set", path: ["bodies", id], value: { points: entries }, block: 1 }],
  };
}

/** Add a point to a body, in the body's own frame. Creates the ground body when needed. */
export function addPoint(doc: Document, body: string, at: Coord): { name: string; edits: Edit[] } {
  const existing = doc.bodies[body];
  const name =
    body === GROUND
      ? freeName(Object.keys(existing?.points ?? {}), "G")
      : freePointName(Object.keys(existing?.points ?? {}));
  const edit: Edit = existing
    ? { op: "set", path: ["bodies", body, "points", name], value: tidyCoord(at) }
    : { op: "set", path: ["bodies", body], value: { points: { [name]: tidyCoord(at) } }, block: 1 };
  return { name, edits: [edit] };
}

export function movePoint(body: string, point: string, at: Coord): Edit[] {
  return [{ op: "set", path: ["bodies", body, "points", point], value: tidyCoord(at) }];
}

/** The revolute joint pinning two points together, if there is one. */
export function findRevolute(doc: Document, a: string, b: string): string | undefined {
  return Object.entries(doc.joints ?? {}).find(
    ([, joint]) =>
      joint.type === "revolute" &&
      ((joint.connect[0] === a && joint.connect[1] === b) ||
        (joint.connect[0] === b && joint.connect[1] === a)),
  )?.[0];
}

export function addRevolute(doc: Document, a: string, b: string): { id: string; edits: Edit[] } {
  const id = freeName(Object.keys(doc.joints ?? {}), "pin");
  return {
    id,
    edits: [{ op: "set", path: ["joints", id], value: { type: "revolute", connect: [a, b] } }],
  };
}

export function driversOf(doc: Document, joint: string): string[] {
  return Object.entries(doc.drivers ?? {})
    .filter(([, driver]) => driver.joint === joint)
    .map(([id]) => id);
}

export function addDriver(doc: Document, joint: string): { id: string; edits: Edit[] } {
  const taken = Object.keys(doc.drivers ?? {});
  const id = taken.includes("motor") ? freeName(taken, "motor") : "motor";
  return { id, edits: [{ op: "set", path: ["drivers", id], value: { joint, speed: 60 } }] };
}

/** Start or stop recording the path of a point. */
export function toggleTrace(doc: Document, ref: string): Edit[] {
  const traces = doc.traces ?? [];
  const index = traces.indexOf(ref);
  if (index >= 0) return [{ op: "delete", path: ["traces", index] }];
  if (!doc.traces) return [{ op: "set", path: ["traces"], value: [ref] }];
  return [{ op: "set", path: ["traces", traces.length], value: ref }];
}

function removeTraces(doc: Document, matches: (ref: string) => boolean): Edit[] {
  // From the back, so that earlier removals do not shift the later ones.
  return (doc.traces ?? [])
    .map((ref, index) => ({ ref, index }))
    .filter(({ ref }) => matches(ref))
    .reverse()
    .map(({ index }): Edit => ({ op: "delete", path: ["traces", index] }));
}

/** Remove the frames that stand on, or point along, what is being removed. */
function removeFrames(doc: Document, matches: (ref: string) => boolean, body?: string): Edit[] {
  return Object.entries(doc.frames ?? {})
    .filter(
      ([, frame]) =>
        (frame.origin !== undefined && matches(frame.origin)) ||
        (frame.along?.some(matches) ?? false) ||
        (body !== undefined && frame.body === body),
    )
    .map(([id]): Edit => ({ op: "delete", path: ["frames", id] }));
}

/** Remove joints, and the drivers that act on them. */
function removeJoints(doc: Document, ids: string[]): Edit[] {
  return [
    ...ids
      .flatMap((id) => driversOf(doc, id))
      .map((id): Edit => ({ op: "delete", path: ["drivers", id] })),
    ...ids.map((id): Edit => ({ op: "delete", path: ["joints", id] })),
  ];
}

export function removeJoint(doc: Document, id: string): Edit[] {
  return removeJoints(doc, [id]);
}

function jointsUsing(doc: Document, matches: (ref: string) => boolean): string[] {
  return Object.entries(doc.joints ?? {})
    .filter(([, joint]) => jointRefs(joint).some(matches))
    .map(([id]) => id);
}

/**
 * Remove a point with everything that depends on it: its joints, their drivers, its
 * trace, and the frames on it.
 */
export function removePoint(doc: Document, body: string, point: string): Edit[] {
  const ref = `${body}.${point}`;
  return [
    ...removeJoints(
      doc,
      jointsUsing(doc, (r) => r === ref),
    ),
    ...removeTraces(doc, (r) => r === ref),
    ...removeFrames(doc, (r) => r === ref),
    { op: "delete", path: ["bodies", body, "points", point] },
  ];
}

/** Remove a body with everything that depends on it. Measures that mention it are left to report. */
export function removeBody(doc: Document, id: string): Edit[] {
  const mine = (ref: string): boolean => bodyOf(ref) === id;
  return [
    ...removeJoints(doc, jointsUsing(doc, mine)),
    ...removeTraces(doc, mine),
    ...removeFrames(doc, mine, id),
    ...(doc.pose?.[id] ? [{ op: "delete", path: ["pose", id] } satisfies Edit] : []),
    { op: "delete", path: ["bodies", id] },
  ];
}

/** Record where bodies are, as `[x, y, angle]` in document units. */
export function setPose(poses: Record<string, [number, number, number]>): Edit[] {
  return Object.entries(poses).map(
    ([id, pose]): Edit => ({ op: "set", path: ["pose", id], value: pose.map(tidy) }),
  );
}

/** Add a measure under a free name starting with `base`. */
export function addMeasure(
  doc: Document,
  base: string,
  expr: string,
): { id: string; edits: Edit[] } {
  const id = freeName(Object.keys(doc.measures ?? {}), base);
  return { id, edits: [{ op: "set", path: ["measures", id], value: expr }] };
}

/** Add a chart of one or more expressions under a free name starting with `base`. */
export function addPlot(
  doc: Document,
  base: string,
  series: string[],
): { id: string; edits: Edit[] } {
  const taken = Object.keys(doc.plots ?? {});
  const id = taken.includes(base) ? freeName(taken, `${base}_`) : base;
  return { id, edits: [{ op: "set", path: ["plots", id], value: series }] };
}

/** Add a frame under a free name starting with `base`. */
export function addFrame(
  doc: Document,
  base: string,
  frame: NonNullable<Document["frames"]>[string],
): { id: string; edits: Edit[] } {
  const id = freeName(Object.keys(doc.frames ?? {}), base);
  return { id, edits: [{ op: "set", path: ["frames", id], value: frame as unknown as Value }] };
}

/** Add a joint of any kind under a free name starting with `base`. */
export function addJoint(
  doc: Document,
  base: string,
  joint: NonNullable<Document["joints"]>[string],
): { id: string; edits: Edit[] } {
  const id = freeName(Object.keys(doc.joints ?? {}), base);
  return { id, edits: [{ op: "set", path: ["joints", id], value: joint as unknown as Value }] };
}

/** Add a crank or a rod under a free name starting with `base`. */
export function addComponent(
  doc: Document,
  base: string,
  component: NonNullable<Document["components"]>[string],
): { id: string; edits: Edit[] } {
  // A component stands for a body of the same name, so it must not clash with one.
  const taken = [...Object.keys(doc.bodies), ...Object.keys(doc.components ?? {})];
  const id = freeName(taken, base);
  return {
    id,
    edits: [
      { op: "set", path: ["components", id], value: component as unknown as Value, block: 1 },
    ],
  };
}

/**
 * Add a measure under a given name, or a numbered variant of it when the name is
 * taken. Nothing is added when the model already measures the same expression.
 */
export function nameMeasure(doc: Document, name: string, expr: string): Edit[] {
  const measures = doc.measures ?? {};
  if (Object.values(measures).some((existing) => existing === expr)) return [];
  const id = name in measures ? freeName(Object.keys(measures), `${name}_`) : name;
  return [{ op: "set", path: ["measures", id], value: expr }];
}
