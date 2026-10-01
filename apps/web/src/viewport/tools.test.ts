import { NEW_MODEL } from "@mekasim/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.ts";
import type { Scene } from "./scene.ts";
import {
  clickLink,
  clickMeasure,
  clickMotor,
  clickPin,
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

  it("adds the angle of a link clicked away from its points", () => {
    clickMeasure(scene(), 0.07, 0.07, TOL);
    expect(text()).toContain("  angle1: angle(link2)\n");
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
