import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { external, linkedNames, linkedSpans } from "./linked.ts";

const MODEL = `mekasim: 1
params:
  r: 40 mm
bodies:
  ground:
    points: { O2: [0, 0] }
  crank:
    points: { O: [0, 0], A: [r, 0] }
  coupler:
    points: { A: [0, 0], B: [160, 0] }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
  pin_a: { type: revolute, connect: [crank.A, coupler.A] }
drivers:
  motor: { joint: main, speed: 60 }
measures:
  swing: range(angle(crank))
pose:
  crank: [0, 0, 10]
`;

function editor(): EditorState {
  return EditorState.create({ doc: MODEL, extensions: [linkedNames()] });
}

/** Put the cursor at a place in the text, as a click or an arrow key does. */
function cursor(state: EditorState, at: number): EditorState {
  return state.update({ selection: { anchor: at } }).state;
}

/** Type or delete, as the keyboard does. */
function type(state: EditorState, from: number, to: number, insert: string): EditorState {
  const event = insert ? "input.type" : "delete.backward";
  return state.update({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: event,
  }).state;
}

const CRANK = MODEL.indexOf("  crank:") + 2;

describe("renaming by editing a definition", () => {
  it("marks every use of the name the cursor is put on", () => {
    const state = cursor(editor(), CRANK + 2);
    const spans = linkedSpans(state);
    expect(spans?.references.map(({ from, to }) => MODEL.slice(from, to))).toEqual([
      "crank",
      "crank",
      "crank",
      "crank",
    ]);
  });

  it("types into every use at once", () => {
    let state = cursor(editor(), CRANK + 5);
    state = type(state, CRANK + 5, CRANK + 5, "_");
    state = type(state, CRANK + 6, CRANK + 6, "1");
    const text = state.doc.toString();
    expect(text).toContain("  crank_1:\n");
    expect(text).toContain("connect: [ground.O2, crank_1.O]");
    expect(text).toContain("connect: [crank_1.A, coupler.A]");
    expect(text).toContain("swing: range(angle(crank_1))");
    expect(text).toContain("pose:\n  crank_1: [0, 0, 10]");
    expect(text).not.toMatch(/crank[^_]/);
  });

  it("follows a name that is wiped and typed anew", () => {
    let state = cursor(editor(), CRANK);
    state = state.update({ selection: { anchor: CRANK, head: CRANK + 5 } }).state;
    state = type(state, CRANK, CRANK + 5, "");
    expect(state.doc.toString()).toContain("connect: [ground.O2, .O]");
    for (const [i, letter] of [..."arm"].entries())
      state = type(state, CRANK + i, CRANK + i, letter);
    const text = state.doc.toString();
    expect(text).toContain("  arm:\n");
    expect(text).toContain("connect: [arm.A, coupler.A]");
    expect(text).toContain("  arm: [0, 0, 10]");
    expect(text).not.toContain("crank");
  });

  it("renames a point only on its own body", () => {
    const at = MODEL.indexOf("A: [r, 0]");
    let state = cursor(editor(), at + 1);
    state = type(state, at + 1, at + 1, "x");
    const text = state.doc.toString();
    expect(text).toContain("O: [0, 0], Ax: [r, 0]");
    expect(text).toContain("connect: [crank.Ax, coupler.A]");
    expect(text).toContain("points: { A: [0, 0], B: [160, 0] }");
  });

  it("renames a parameter and a pin likewise", () => {
    const param = MODEL.indexOf("  r: 40") + 2;
    let state = cursor(editor(), param + 1);
    state = type(state, param + 1, param + 1, "adius");
    expect(state.doc.toString()).toContain("A: [radius, 0]");

    const pin = MODEL.indexOf("  main:") + 2;
    state = cursor(editor(), pin + 4);
    state = type(state, pin + 4, pin + 4, "_pin");
    expect(state.doc.toString()).toContain("motor: { joint: main_pin, speed: 60 }");
  });

  it("leaves the other uses alone when a reference is edited", () => {
    const reference = MODEL.indexOf("crank.O]");
    let state = cursor(editor(), reference + 5);
    expect(linkedSpans(state)).toBeNull();
    state = type(state, reference + 5, reference + 5, "2");
    expect(state.doc.toString()).toContain("  crank:\n");
    expect(state.doc.toString()).toContain("connect: [ground.O2, crank2.O]");
  });

  it("stops when the cursor leaves the name", () => {
    let state = cursor(editor(), CRANK + 5);
    state = cursor(state, 0);
    expect(linkedSpans(state)).toBeNull();
    state = type(state, CRANK + 5, CRANK + 5, "x");
    expect(state.doc.toString()).toContain("connect: [ground.O2, crank.O]");
  });

  it("does not start while a name is being typed, however it reads on the way", () => {
    // Typing a new measure called "crank_speed" passes through "crank", the name of a link.
    const end = MODEL.indexOf("pose:");
    let state = cursor(editor(), end);
    state = type(state, end, end, "  crank");
    expect(linkedSpans(state)).toBeNull();
    state = type(state, end + 7, end + 7, "_speed: 1\n");
    expect(state.doc.toString()).toContain("swing: range(angle(crank))");
  });

  it("does not repeat what is not part of a name, and lets go", () => {
    let state = cursor(editor(), CRANK + 5);
    state = type(state, CRANK + 5, CRANK + 5, " ");
    expect(state.doc.toString()).toContain("connect: [ground.O2, crank.O]");
    expect(linkedSpans(state)).toBeNull();
  });

  it("does not take a change from the drawing for a rename", () => {
    let state = cursor(editor(), CRANK + 5);
    state = state.update({
      changes: { from: CRANK + 5, insert: "X" },
      userEvent: "input.canvas",
      annotations: external.of(true),
    }).state;
    expect(state.doc.toString()).toContain("connect: [ground.O2, crank.O]");
    expect(linkedSpans(state)).toBeNull();
  });
});
