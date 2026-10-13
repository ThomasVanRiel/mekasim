import { undo, undoDepth } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { LIVE, undoGrouping } from "./history.ts";
import { linkedNames } from "./linked.ts";

const MODEL = `mekasim: 1
params:
  r: 40 mm
bodies:
  crank:
    points: { O: [0, 0], A: [r, 0] }
joints:
  main: { type: revolute, connect: [ground.O2, crank.O] }
`;

function editor(): EditorState {
  return EditorState.create({ doc: MODEL, extensions: [undoGrouping(), linkedNames()] });
}

/** Type letters one key at a time, starting at a place. */
function type(state: EditorState, at: number, letters: string): EditorState {
  let next = state;
  for (const [i, letter] of [...letters].entries()) {
    next = next.update({
      changes: { from: at + i, insert: letter },
      selection: { anchor: at + i + 1 },
      userEvent: "input.type",
    }).state;
  }
  return next;
}

function undone(state: EditorState): EditorState {
  let result: Transaction | undefined;
  undo({
    state,
    dispatch: (tr) => {
      result = tr;
    },
  });
  if (!result) throw new Error("nothing to undo");
  return result.state;
}

describe("undo steps", () => {
  it("takes a run of typing as one step", () => {
    const state = type(editor(), MODEL.indexOf("40"), "123");
    expect(undoDepth(state)).toBe(1);
    expect(undone(state).doc.toString()).toBe(MODEL);
  });

  it("takes typing in two places as two steps", () => {
    let state = type(editor(), MODEL.indexOf("40"), "12");
    state = type(state, MODEL.indexOf("main"), "ab");
    expect(undoDepth(state)).toBe(2);
  });

  it("takes a rename, typed into every use at once, as one step", () => {
    const at = MODEL.indexOf("  crank:") + 7;
    let state = editor().update({ selection: { anchor: at } }).state;
    state = type(state, at, "_arm");
    expect(state.doc.toString()).toContain("crank_arm.O]");
    expect(undoDepth(state)).toBe(1);
    expect(undone(state).doc.toString()).toBe(MODEL);
  });

  it("takes the steps of one drag on the drawing as one step, wherever they fall", () => {
    let state = editor();
    // A drag rewrites values in two different places, again and again.
    for (const value of ["41", "42", "43"]) {
      const text = state.doc.toString();
      const a = text.indexOf(" mm") - 2;
      const b = text.indexOf("[0, 0]") + 1;
      state = state.update({
        changes: [
          { from: a, to: a + 2, insert: value },
          { from: b, to: b + 1, insert: value[1] as string },
        ],
        userEvent: LIVE,
      }).state;
    }
    expect(undoDepth(state)).toBe(1);
    expect(undone(state).doc.toString()).toBe(MODEL);
  });

  it("takes separate changes from the drawing as separate steps", () => {
    let state = editor();
    for (const value of ["41", "42"]) {
      const at = state.doc.toString().indexOf(" mm") - 2;
      state = state.update({
        changes: { from: at, to: at + 2, insert: value },
        userEvent: "input.canvas",
      }).state;
    }
    expect(undoDepth(state)).toBe(2);
  });
});
