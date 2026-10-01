import { describe, expect, it } from "vitest";
import {
  addBody,
  addDriver,
  addPoint,
  addRevolute,
  editText,
  freeName,
  freePointName,
  NEW_MODEL,
  removeBody,
  removeJoint,
  removePoint,
  setPose,
  toggleTrace,
} from "../src/edit/operations.ts";
import type { Edit } from "../src/edit/patch.ts";
import type { Document } from "../src/schema/document.ts";
import { load } from "../src/schema/load.ts";
import { simulate } from "../src/simulate.ts";

function read(text: string): Document {
  const { doc, diagnostics } = load(text);
  if (!doc) throw new Error(diagnostics.map((d) => d.message).join("; "));
  return doc;
}

/** Run an operation against the current text and return the new text. */
function step(text: string, operation: (doc: Document) => Edit[]): string {
  return editText(text, operation(read(text)));
}

/** A four-bar built the way the drawing tools build it. */
function fourBar(): string {
  let text = NEW_MODEL;
  text = step(text, (doc) => addPoint(doc, "ground", [0, 0]).edits);
  text = step(text, (doc) => addPoint(doc, "ground", [180, 0]).edits);
  text = step(
    text,
    (doc) =>
      addBody(doc, [
        [0, 0],
        [0, 40],
      ]).edits,
  );
  text = step(
    text,
    (doc) =>
      addBody(doc, [
        [0, 40],
        [140, 100],
      ]).edits,
  );
  text = step(
    text,
    (doc) =>
      addBody(doc, [
        [140, 100],
        [180, 0],
      ]).edits,
  );
  text = step(text, (doc) => addRevolute(doc, "ground.G1", "link1.A").edits);
  text = step(text, (doc) => addRevolute(doc, "link1.B", "link2.A").edits);
  text = step(text, (doc) => addRevolute(doc, "link2.B", "link3.A").edits);
  text = step(text, (doc) => addRevolute(doc, "link3.B", "ground.G2").edits);
  text = step(text, (doc) => addDriver(doc, "pin1").edits);
  text = step(text, (doc) => toggleTrace(doc, "link2.B"));
  return text;
}

describe("names", () => {
  it("takes the first free numbered name", () => {
    expect(freeName(["link1", "link3"], "link")).toBe("link2");
  });

  it("goes through the alphabet and then adds a number", () => {
    expect(freePointName(["A", "B"])).toBe("C");
    const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    expect(freePointName(alphabet)).toBe("A1");
  });
});

describe("building a model", () => {
  it("produces tidy text", () => {
    expect(fourBar()).toBe(`mekasim: 1
meta:
  name: Untitled model

bodies:
  ground:
    points: { G1: [0, 0], G2: [180, 0] }
  link1:
    points: { A: [0, 0], B: [0, 40] }
  link2:
    points: { A: [0, 40], B: [140, 100] }
  link3:
    points: { A: [140, 100], B: [180, 0] }

joints:
  pin1: { type: revolute, connect: [ground.G1, link1.A] }
  pin2: { type: revolute, connect: [link1.B, link2.A] }
  pin3: { type: revolute, connect: [link2.B, link3.A] }
  pin4: { type: revolute, connect: [link3.B, ground.G2] }

drivers:
  motor: { joint: pin1, speed: 60 }

traces: [link2.B]
`);
  });

  it("produces a mechanism that runs", () => {
    const simulation = simulate(fourBar());
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.cycle?.count).toBe(360);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0 });
  });

  it("rounds mouse positions to a thousandth of a unit", () => {
    const text = step(
      NEW_MODEL,
      (doc) =>
        addBody(doc, [
          [12.34567, -0.00004],
          [1 / 3, 99.9996],
        ]).edits,
    );
    expect(text).toContain("points: { A: [12.346, 0], B: [0.333, 100] }");
  });

  it("stops recording a trace that is toggled again", () => {
    const text = step(fourBar(), (doc) => toggleTrace(doc, "link2.B"));
    expect(read(text).traces).toEqual([]);
  });

  it("records poses", () => {
    const text = editText(fourBar(), setPose({ link1: [0, 0, 12.34567], link2: [1, 2, 3] }));
    expect(text.endsWith("\npose:\n  link1: [0, 0, 12.346]\n  link2: [1, 2, 3]\n")).toBe(true);
  });
});

describe("removing", () => {
  it("takes a joint's driver with it", () => {
    const doc = read(step(fourBar(), (d) => removeJoint(d, "pin1")));
    expect(Object.keys(doc.joints ?? {})).toEqual(["pin2", "pin3", "pin4"]);
    expect(doc.drivers).toEqual({});
  });

  it("takes a point's joints and trace with it", () => {
    const doc = read(step(fourBar(), (d) => removePoint(d, "link2", "B")));
    expect(doc.bodies.link2?.points).toEqual({ A: [0, 40] });
    expect(Object.keys(doc.joints ?? {})).toEqual(["pin1", "pin2", "pin4"]);
    expect(doc.traces).toEqual([]);
  });

  it("takes everything attached to a body with it", () => {
    const posed = editText(fourBar(), setPose({ link1: [0, 0, 0], link2: [0, 0, 0] }));
    const text = step(posed, (d) => removeBody(d, "link1"));
    const doc = read(text);
    expect(Object.keys(doc.bodies)).toEqual(["ground", "link2", "link3"]);
    expect(Object.keys(doc.joints ?? {})).toEqual(["pin3", "pin4"]);
    expect(doc.drivers).toEqual({});
    expect(doc.pose).toEqual({ link2: [0, 0, 0] });
    // What is left is still a valid model.
    expect(simulate(text).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
