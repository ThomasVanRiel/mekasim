import { NEW_MODEL } from "@mekasim/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.ts";
import type { Scene } from "./scene.ts";
import {
  clickCam,
  clickCrank,
  clickGear,
  clickLink,
  clickMeasure,
  clickMotor,
  clickPin,
  clickRod,
  clickSlot,
  clickTie,
  clickTrace,
  deleteSelection,
  finishLink,
  grab,
  pull,
  release,
  reshapeTo,
  snap,
  startReshape,
} from "./tools.ts";

/** Reach of a click, in metres: 4 mm. */
const TOL = 0.004;

function scene(): Scene {
  const current = useStore.getState().scene;
  if (!current) throw new Error("nothing is drawn");
  return current;
}

/** Click with the link tool at a position in millimetres. */
function place(x: number, y: number): void {
  clickLink(snap(scene(), x / 1000, y / 1000, TOL), TOL);
}

/** Draw a link through positions in millimetres. */
function link(...points: [number, number][]): void {
  for (const [x, y] of points) place(x, y);
  finishLink();
}

function text(): string {
  return useStore.getState().text;
}

/** Draw the three links of a four-bar and pin its two ends to the ground. */
function drawFourBar(): void {
  link([0, 0], [0, 40]);
  link([0, 40], [140, 100]);
  link([140, 100], [180, 0]);
  clickPin(scene(), 0, 0, TOL);
  clickPin(scene(), 0.18, 0, TOL);
}

beforeEach(() => {
  useStore.getState().load(NEW_MODEL);
  useStore.getState().setTool("link");
});

describe("drawing a four-bar from an empty sheet", () => {
  it("writes a clean model that runs", () => {
    drawFourBar();
    clickMotor(scene(), 0, 0, TOL);
    clickTrace(scene(), 0.14, 0.1, TOL);

    expect(text()).toBe(`mekasim: 1
meta:
  name: Untitled model

bodies:
  link1:
    points: { A: [0, 0], B: [0, 40] }
  link2:
    points: { A: [0, 40], B: [140, 100] }
  link3:
    points: { A: [140, 100], B: [180, 0] }
  ground:
    points: { G1: [0, 0], G2: [180, 0] }

joints:
  pin1: { type: revolute, connect: [link1.B, link2.A] }
  pin2: { type: revolute, connect: [link2.B, link3.A] }
  pin3: { type: revolute, connect: [ground.G1, link1.A] }
  pin4: { type: revolute, connect: [ground.G2, link3.B] }

drivers:
  motor: { joint: pin3, speed: 60 }

traces: [link2.B]
`);
    const { simulation } = useStore.getState();
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.cycle?.count).toBe(360);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0 });
  });

  it("pins a new link to the points it is drawn on", () => {
    link([0, 0], [100, 0]);
    // Clicking a little off the end still lands on it.
    link([101, 1], [150, 80]);
    expect(text()).toContain("pin1: { type: revolute, connect: [link1.B, link2.A] }");
    expect(text()).toContain("link2:\n    points: { A: [100, 0], B: [150, 80] }");
  });

  it("snaps free clicks to the fine grid", () => {
    // On the empty sheet a grid square is 20 mm, so the fine grid is 2 mm.
    link([12.9, 7.2], [99.1, 0.8]);
    expect(text()).toContain("points: { A: [12, 8], B: [100, 0] }");
  });

  it("finishes a link when its last point is clicked again", () => {
    place(0, 0);
    place(60, 0);
    place(60, 40);
    place(60, 40);
    expect(useStore.getState().draft).toEqual([]);
    expect(text()).toContain("points: { A: [0, 0], B: [60, 0], C: [60, 40] }");
  });

  it("asks for a second point instead of making a link of one", () => {
    place(0, 0);
    finishLink();
    expect(useStore.getState().notice).toContain("at least two points");
    expect(text()).toBe(NEW_MODEL);
  });
});

describe("pin, motor and trace", () => {
  beforeEach(drawFourBar);

  it("says so when there is nothing to pin", () => {
    clickPin(scene(), 0.05, 0.05, TOL);
    expect(useStore.getState().notice).toContain("no point here");
    clickPin(scene(), 0, 0.04, TOL);
    expect(useStore.getState().notice).toContain("already pinned");
  });

  it("removes the motor when a driven pin is clicked again", () => {
    clickMotor(scene(), 0, 0, TOL);
    expect(text()).toContain("motor: { joint: pin3, speed: 60 }");
    clickMotor(scene(), 0, 0, TOL);
    expect(text()).toContain("drivers: {}");
  });

  it("removes the selected link with its pins", () => {
    useStore.getState().select({ kind: "body", id: "link2" });
    deleteSelection();
    expect(text()).not.toContain("link2");
    expect(text()).toContain("pin3:");
    expect(text()).not.toContain("pin1:");
    expect(useStore.getState().selection).toBeUndefined();
  });
});

describe("measuring", () => {
  beforeEach(drawFourBar);

  it("adds the distance between two clicked points", () => {
    clickMeasure(scene(), 0, 0, TOL);
    expect(useStore.getState().draft).toHaveLength(1);
    clickMeasure(scene(), 0.14, 0.1, TOL);
    expect(text()).toContain("measures:\n  dist1: dist(ground.G1, link2.B)\n");
    expect(useStore.getState().draft).toEqual([]);
    const measure = useStore.getState().simulation.measures.find((m) => m.id === "dist1");
    const values = measure?.quantity?.value;
    expect(typeof values === "object" ? values[0] : undefined).toBeCloseTo(
      Math.hypot(0.14, 0.1),
      9,
    );
  });

  it("measures how far a link clicked away from its points has moved and turned", () => {
    clickMeasure(scene(), 0.07, 0.07, TOL);
    expect(text()).toContain(
      "measures:\n  link2_dx: change(x(link2))\n  link2_dy: change(y(link2))\n  link2_moved: moved(link2)\n  link2_turn: change(angle(link2))\n",
    );
    // At the start nothing has moved yet.
    const value = (id: string) => {
      const found = useStore.getState().simulation.measures.find((m) => m.id === id)
        ?.quantity?.value;
      return typeof found === "object" ? found[0] : undefined;
    };
    expect(value("link2_dx")).toBe(0);
    expect(value("link2_turn")).toBe(0);
  });

  it("does not measure the same thing twice", () => {
    clickMeasure(scene(), 0.07, 0.07, TOL);
    const once = text();
    clickMeasure(scene(), 0.07, 0.07, TOL);
    expect(text()).toBe(once);
  });

  it("asks for a different point when the same one is clicked twice", () => {
    clickMeasure(scene(), 0.14, 0.1, TOL);
    clickMeasure(scene(), 0.14, 0.1, TOL);
    expect(useStore.getState().notice).toContain("same point");
    expect(text()).not.toContain("measures:");
  });
});

describe("reshaping", () => {
  beforeEach(drawFourBar);

  it("moves pinned points together, so the pin stays closed", () => {
    const reshape = startReshape(scene(), 0.14, 0.1, TOL);
    expect(reshape?.points.map((p) => p.ref).sort()).toEqual(["link2.B", "link3.A"]);
    if (reshape) reshapeTo(reshape, 0.15, 0.09);
    expect(text()).toContain("points: { A: [0, 40], B: [150, 90] }");
    expect(text()).toContain("points: { A: [150, 90], B: [180, 0] }");
    expect(
      useStore.getState().simulation.diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
  });

  it("moves a ground pivot with the link end pinned to it", () => {
    const reshape = startReshape(scene(), 0.18, 0, TOL);
    if (reshape) reshapeTo(reshape, 0.2, 0.01);
    expect(text()).toContain("G2: [200, 10]");
    expect(text()).toContain("B: [200, 10] }");
  });

  it("leaves points alone that are set by an expression", () => {
    useStore.getState().apply([
      { op: "set", path: ["params", "h"], value: "40 mm" },
      { op: "set", path: ["bodies", "link1", "points", "B"], value: [0, "h"] },
    ]);
    expect(startReshape(scene(), 0, 0.04, TOL)).toBeUndefined();
    expect(useStore.getState().notice).toContain("set by an expression");
  });
});

describe("dragging", () => {
  beforeEach(drawFourBar);

  it("poses an undriven mechanism and records where it was left", () => {
    useStore.getState().setTool("select");
    const held = grab(scene(), { kind: "joint", id: "pin1" }, 0, 0.04);
    expect(held?.mode).toBe("pose");
    if (!held) return;
    // Pull the crank tip round to the right; it can only follow its circle.
    pull(scene(), held, 0.04, 0);
    expect(scene().override).toBeDefined();
    release(scene(), held);
    expect(scene().override).toBeUndefined();
    expect(text()).toMatch(/pose:\n {2}link1: \[0, 0, -90\]\n {2}link2: /);
    expect(
      useStore.getState().simulation.diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
  });

  it("scrubs a driven mechanism through its cycle", () => {
    clickMotor(scene(), 0, 0, TOL);
    useStore.getState().setTool("select");
    const held = grab(scene(), { kind: "joint", id: "pin1" }, 0, 0.04);
    expect(held?.mode).toBe("scrub");
    if (!held) return;
    // The crank starts pointing up; 30 degrees further round is step 30.
    pull(
      scene(),
      held,
      0.04 * Math.cos((120 * Math.PI) / 180),
      0.04 * Math.sin((120 * Math.PI) / 180),
    );
    expect(useStore.getState().step).toBe(30);
    expect(useStore.getState().playing).toBe(false);
  });
});

describe("components on the sheet", () => {
  const model = `mekasim: 1
components:
  shaft: { type: crank, at: [0, 0], arms: { A: [20, 90] }, speed: 60 }
  rocker: { type: crank, at: [100, 0], arms: { B: [40, 90] } }
  rod: { type: rod, length: 105, connect: [shaft.A, rocker.B] }
`;
  beforeEach(() => useStore.getState().load(model));

  it("are drawn and run like bodies written out by hand", () => {
    const { simulation } = useStore.getState();
    expect(simulation.diagnostics).toEqual([]);
    expect(scene().bodies.map((b) => b.id)).toEqual(["shaft", "rocker", "rod"]);
    expect(scene().pins.map((p) => p.id)).toEqual(["shaft", "rocker", "rod_a", "rod_b"]);
  });

  it("cannot be reshaped by dragging, and say why", () => {
    expect(startReshape(scene(), 0, 0.02, TOL)).toBeUndefined();
    expect(useStore.getState().notice).toContain("belongs to a crank or rod");
    expect(text()).toBe(model);
  });

  it("are removed as a whole", () => {
    useStore.getState().select({ kind: "joint", id: "rod_a" });
    deleteSelection();
    expect(useStore.getState().notice).toContain("belongs to a crank or rod");
    expect(text()).toBe(model);

    useStore.getState().select({ kind: "body", id: "rod" });
    deleteSelection();
    expect(text()).not.toContain("rod:");
    expect(text()).toContain("rocker:");
  });

  it("can have links drawn onto their points", () => {
    useStore.getState().setTool("link");
    link([100, 40], [160, 80]);
    expect(text()).toContain("pin1: { type: revolute, connect: [rocker.B, link1.A] }");
    expect(
      useStore.getState().simulation.diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
  });
});

describe("drawing cranks, rods and joints", () => {
  /** Click with the crank tool at a position in millimetres. */
  function crankAt(x: number, y: number): void {
    clickCrank(snap(scene(), x / 1000, y / 1000, TOL), TOL);
  }

  function errors(): string[] {
    return useStore
      .getState()
      .simulation.diagnostics.filter((d) => d.severity === "error")
      .map((d) => d.message);
  }

  it("draws a four-bar from two cranks and a rod, with no coordinates but the pivots", () => {
    crankAt(0, 0);
    crankAt(0, 40);
    crankAt(180, 0);
    crankAt(140, 100);
    clickRod(scene(), 0, 0.04, TOL);
    clickRod(scene(), 0.14, 0.1, TOL);
    clickMotor(scene(), 0, 0, TOL);

    expect(text()).toBe(`mekasim: 1
meta:
  name: Untitled model

bodies: {}

components:
  crank1:
    type: crank
    at: [0, 0]
    arms: { A: [40, 90] }
  crank2:
    type: crank
    at: [180, 0]
    arms: { A: [107.703, 111.801] }
  rod1:
    type: rod
    length: 152.316
    connect: [crank1.A, crank2.A]

drivers:
  motor: { joint: crank1, speed: 60 }
`);
    expect(errors()).toEqual([]);
    expect(useStore.getState().simulation.mobility).toMatchObject({ mobility: 1, free: 0 });
    expect(useStore.getState().simulation.cycle?.count).toBe(360);
  });

  it("mounts a crank on an existing point and pins its arm to another", () => {
    link([0, 0], [100, 0]);
    link([0, 60], [100, 60]);
    crankAt(100, 0);
    crankAt(100, 60);
    expect(text()).toContain("    at: link1.B\n    arms: { A: [60, 90] }");
    expect(text()).toContain("connect: [link2.B, crank1.A]");
  });

  it("asks for an arm with some length", () => {
    crankAt(0, 0);
    crankAt(0, 0);
    expect(useStore.getState().notice).toContain("away from the pivot");
    expect(text()).toBe(NEW_MODEL);
  });

  it("runs a rod only between points of different bodies", () => {
    link([0, 0], [100, 0]);
    clickRod(scene(), 0, 0, TOL);
    clickRod(scene(), 0.1, 0, TOL);
    expect(useStore.getState().notice).toContain("same body");
    clickRod(scene(), 0.05, 0.05, TOL);
    expect(useStore.getState().notice).toContain("Click on a point");
  });

  it("guides a point along a line fixed to the ground", () => {
    link([0, 0], [0, 30]);
    link([0, 30], [100, 30]);
    clickPin(scene(), 0, 0, TOL);
    clickSlot(scene(), snap(scene(), 0.1, 0.03, TOL), TOL);
    clickSlot(scene(), snap(scene(), 0.16, 0.03, TOL), TOL);
    expect(text()).toContain("points: { G1: [0, 0], G2: [100, 30], G3: [160, 30] }");
    expect(text()).toContain(
      "slot1: { type: pin-slot, axis: [ground.G2, ground.G3], point: link2.B }",
    );
    clickMotor(scene(), 0, 0, TOL);
    // A slider-crank: one freedom, taken by the motor.
    expect(errors()).toEqual([]);
    expect(useStore.getState().simulation.mobility).toMatchObject({ mobility: 1, free: 0 });
  });

  it("starts a slot only on a point of a link", () => {
    clickSlot(scene(), snap(scene(), 0.05, 0.05, TOL), TOL);
    expect(useStore.getState().notice).toContain("should slide");
    expect(useStore.getState().draft).toEqual([]);
  });

  it("ties two points at the distance they are", () => {
    link([0, 0], [0, 40]);
    link([140, 100], [180, 0]);
    clickTie(scene(), 0, 0.04, TOL);
    clickTie(scene(), 0.14, 0.1, TOL);
    expect(text()).toContain(
      "tie1: { type: distance, connect: [link1.B, link2.A], length: 152.315 }",
    );
    expect(errors()).toEqual([]);
  });

  it("gears two cranks by their centres", () => {
    crankAt(0, 0);
    crankAt(20, 0);
    crankAt(60, 0);
    crankAt(60, 40);
    clickGear(scene(), 0, 0, TOL);
    clickGear(scene(), 0.06, 0, TOL);
    expect(text()).toContain(
      "gear1: { type: gear, connect: [crank1.O, crank2.O], sizes: [20, 20] }",
    );
    expect(errors()).toEqual([]);
    expect(scene().wheels).toHaveLength(2);
  });

  it("puts a cam between a turning body and a follower, with a first lift diagram", () => {
    crankAt(0, 0);
    crankAt(20, 0);
    link([0, 30], [0, 90]);
    clickCam(scene(), 0, 0, TOL);
    clickCam(scene(), 0, 0.03, TOL);
    expect(text()).toContain(
      "cam1: { type: cam, cam: crank1.O, follower: link1.A, base: 30, profile: [[0, 0], [120, 9], [180, 9], [300, 0]] }",
    );
    expect(errors()).toEqual([]);
    expect(scene().cams).toHaveLength(1);
  });
});
