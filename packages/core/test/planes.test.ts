import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../src/schema/document.ts";
import { load } from "../src/schema/load.ts";
import { type Simulation, simulate } from "../src/simulate.ts";
import { placePoint } from "../src/solver/spatial.ts";

function example(name: string): string {
  return readFileSync(new URL(`../../../examples/spatial/${name}`, import.meta.url), "utf8");
}

function messages(text: string): string[] {
  return simulate(text)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.message);
}

/** Where a point of a body is in the world at every sample. */
function path(simulation: Simulation, ref: string): [number, number, number][] {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) throw new Error("does not solve");
  const [id, name] = ref.split(".") as [string, string];
  const inSpace = compiled.spatial.get(id);
  const flat = compiled.bodies.get(id) ?? compiled.planeBodies.get(id);
  const point = inSpace
    ? { at: inSpace.at, s: inSpace.points.get(name) as [number, number, number] }
    : {
        at: 3 * (flat?.index as number),
        plane: flat?.plane === undefined ? undefined : compiled.planes.get(flat.plane),
        s: [flat?.points.get(name)?.u ?? 0, flat?.points.get(name)?.v ?? 0, 0] as [
          number,
          number,
          number,
        ],
      };
  if (!inSpace && !point.plane)
    point.plane = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
  const out: [number, number, number][] = [];
  for (let k = 0; k < cycle.count; k++) {
    out.push(placePoint(cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width), point));
  }
  return out;
}

describe("bodies in the plane on planes of their own", () => {
  const planar = simulate(example("rssr-planes.mekasim.yaml"));
  const spatial = simulate(example("rssr.mekasim.yaml"));

  it("solve the RSSR four-bar with only its rod in space", () => {
    expect(planar.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(planar.cycle?.count).toBe(360);
    expect(planar.mobility).toMatchObject({ coordinates: 13, mobility: 1, free: 0, idle: 1 });
  });

  it("move as the same mechanism built of bodies in space", () => {
    for (const [a, b] of [
      ["rocker.B", "rocker.B"],
      ["crank.A", "crank.A"],
      ["coupler.B", "coupler.B"],
    ] as const) {
      const one = path(planar, a);
      const other = path(spatial, b);
      one.forEach((where, k) => {
        for (let i = 0; i < 3; i++)
          expect(Math.abs((where[i] as number) - (other[k]?.[i] as number))).toBeLessThan(1e-9);
      });
    }
  });

  it("keep a body on a plane in that plane", () => {
    for (const [x] of path(planar, "rocker.B")) expect(x).toBeCloseTo(0.05, 12);
  });

  it("are kept apart from the bodies on the sheet, with the joints between them", () => {
    const { compiled } = planar;
    expect([...(compiled?.bodies.keys() ?? [])]).toEqual(["ground", "crank"]);
    expect([...(compiled?.planeBodies.keys() ?? [])]).toEqual(["rocker"]);
    expect(compiled?.joints.map((j) => j.id)).toEqual(["main"]);
    expect(compiled?.planeJoints.map((j) => j.id)).toEqual(["rock"]);
    expect(compiled?.spatialJoints.map((j) => j.id)).toEqual(["ball_a", "ball_b"]);
    const side = compiled?.planes.get("side");
    expect(side?.x).toEqual([0, 1, 0]);
    expect(side?.y).toEqual([0, 0, 1]);
  });
});

const PLANES = `
mekasim: 1
planes:
  side: { origin: [0, 0, 10], normal: [0, 0, 1] }
  wall: { origin: [0, 0, 0], normal: [1, 0, 0] }
bodies:
  ground: { points: { O: [0, 0, 10], F: [0, 0, 0], Q: [40, 0, 10] } }
  a: { plane: side, points: { O: [0, 0], A: [20, 0] } }
  b: { plane: side, points: { A: [0, 0], B: [40, 0] } }
  c: { plane: wall, points: { O: [0, 0], C: [10, 0] } }
  d: { points: { O: [0, 0] } }
`;

describe("planes in the format", () => {
  it("joins bodies on one plane, with the ground's points on it, in its own terms", () => {
    const simulation = simulate(
      `${PLANES}joints:\n  main: { type: revolute, connect: [ground.O, a.O] }\n  pin: { type: revolute, connect: [a.A, b.A] }\n  end: { type: pin-slot, axis: [ground.O, ground.Q], point: b.B }\ndrivers:\n  m: { joint: main, speed: 60 }\n`,
    );
    expect(simulation.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(simulation.cycle?.count).toBe(360);
    // A slider-crank on a plane 10 mm up: the end stays on the line at that height.
    for (const [, y, z] of path(simulation, "b.B")) {
      expect(y).toBeCloseTo(0, 12);
      expect(z).toBeCloseTo(0.01, 12);
    }
  });

  it("says what does not fit", () => {
    expect(
      messages(`${PLANES}joints:\n  j: { type: revolute, connect: [ground.F, a.O] }\n`),
    ).toEqual(['"ground.F" is not on the plane "side"']);
    expect(
      messages(`${PLANES}joints:\n  j: { type: distance, connect: [a.A, c.C], length: 5 }\n`),
    ).toEqual(['"c" is not on the same plane as the rest of this joint']);
    expect(messages(`${PLANES}joints:\n  j: { type: revolute, connect: [a.A, c.C] }\n`)).toEqual([
      "Its bodies are on different planes, so give the hinge an axis: which way it points",
    ]);
    expect(messages(`${PLANES}traces: [a.A]\n`)).toEqual([
      '"a" is on the plane "side", and only bodies on the sheet can be used here so far',
    ]);
    expect(messages(`${PLANES}measures:\n  m: angle(a)\n`)).toEqual([
      '"a" is on the plane "side", and measures of bodies off the sheet are not there yet',
    ]);
    expect(
      messages(
        "mekasim: 1\nbodies:\n  ground: { points: {} }\n  a: { plane: nowhere, points: {} }\n",
      ),
    ).toEqual(['Unknown plane "nowhere"']);
    expect(
      messages(
        "mekasim: 1\nplanes:\n  p: { origin: [0, 0, 0], normal: [0, 0, 1], x: [0, 0, 2] }\n",
      ),
    ).toEqual(["The x axis must not be square to the plane"]);
    expect(
      messages(
        "mekasim: 1\nplanes:\n  p: { origin: [0, 0, 0], normal: [0, 0, 1] }\nbodies:\n  a: { spatial: true, plane: p, points: {} }\n",
      ),
    ).toEqual(["A body in space is on no plane"]);
  });

  it("hinges bodies on different planes about the axis given", () => {
    const simulation = simulate(
      `${PLANES}joints:\n  j: { type: revolute, connect: [a.O, c.O], axis: [0, 1, 0] }\n`,
    );
    expect(simulation.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(simulation.compiled?.spatialJoints.map((j) => j.id)).toEqual(["j"]);
  });

  it("is not part of a format built on mekasim", () => {
    const schema = documentSchema({ version: { key: "mekafit", value: 1 } });
    expect(
      load("mekafit: 1\nplanes:\n  p: { origin: [0, 0, 0], normal: [0, 0, 1] }\n", schema).doc,
    ).toBeUndefined();
    expect(
      load("mekafit: 1\nbodies:\n  a: { plane: p, points: {} }\n", schema).doc,
    ).toBeUndefined();
  });
});
