import {
  type Document,
  type Edit,
  EditError,
  editText,
  load as readModel,
  type Simulation,
  simulate,
} from "@mekasim/core";
import { create } from "zustand";
import { DEFAULT_EXAMPLE } from "./examples.ts";
import type { Hit } from "./viewport/pick.ts";
import { buildScene, type Scene } from "./viewport/scene.ts";

const STORAGE_KEY = "mekasim.text";

/** Playback speeds relative to real time. */
export const RATES = [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

export type Tool = "select" | "link" | "pin" | "motor" | "trace" | "reshape";

/** Edits that belong to one continuous gesture, such as a drag; they undo as one step. */
export const LIVE = "input.type.live";

/** The source editor owns the text and its undo history; these reach into it. */
export const editorBridge: { text?: () => string; undo?: () => void; redo?: () => void } = {};

/** The fastest rate at which one cycle still takes long enough to follow by eye. */
function comfortableRate(period: number): number {
  return RATES.find((rate) => period / rate >= 1.5) ?? (RATES.at(-1) as number);
}

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** A point of a link being drawn, in metres. */
export interface DraftPoint {
  x: number;
  y: number;
  /** The existing point it sits on, as `body.point`. */
  ref?: string;
}

/** A run of changes built on each other's results. */
export interface Transaction {
  /** The model as it stands after the changes so far. */
  doc: Document;
  run(edits: Edit[]): void;
}

interface State {
  text: string;
  /** Result for the current text. */
  simulation: Simulation;
  /** The last result that could be drawn; stays on screen while the text has errors. */
  shown?: Simulation;
  /** The drawing of `shown`. */
  scene?: Scene;
  /** How the editor should record the latest change of `text` that it did not make itself. */
  syncEvent: string;
  /** Position in the cycle as a sample index; fractions fall between samples. */
  step: number;
  playing: boolean;
  /** Playback speed relative to real time. */
  rate: number;
  view: "2d" | "3d";
  labels: boolean;
  tool: Tool;
  selection?: Hit;
  /** The link being drawn. */
  draft: DraftPoint[];
  /** Why the last action did nothing, if it did nothing. */
  notice?: string;
  /** Changes when the view should be fitted to the model again. */
  fitRequest: number;
  /** A place in the text the editor should show. */
  reveal?: { line: number; col: number; request: number; focus: boolean };

  /** Replace the model with new text, as when opening a file. */
  load(text: string): void;
  /** Take new text for the same model. `event` says how the editor should record it. */
  edit(text: string, event?: string): void;
  /** Change the model from the drawing or a panel. Returns false when nothing could be done. */
  transact(build: (tx: Transaction) => void, event?: string): boolean;
  apply(edits: Edit[], event?: string): boolean;
  setStep(step: number): void;
  setPlaying(playing: boolean): void;
  setRate(rate: number): void;
  setView(view: State["view"]): void;
  toggleLabels(): void;
  setTool(tool: Tool): void;
  select(selection: Hit | undefined): void;
  setDraft(draft: DraftPoint[]): void;
  setNotice(notice: string | undefined): void;
  fit(): void;
  revealAt(line: number, col: number): void;
}

type Solved = Pick<State, "text" | "simulation" | "shown" | "scene">;

function solve(text: string, previous?: Pick<State, "shown" | "scene">): Solved {
  const simulation = simulate(text);
  const scene = buildScene(simulation);
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Storage can be unavailable or full; the model still works for this session.
  }
  if (scene) return { text, simulation, shown: simulation, scene };
  return { text, simulation, shown: previous?.shown, scene: previous?.scene };
}

export const useStore = create<State>((set, get) => {
  const initial = solve(stored() ?? DEFAULT_EXAMPLE.text);
  return {
    ...initial,
    syncEvent: "input.canvas",
    step: 0,
    playing: true,
    rate: comfortableRate(initial.shown?.compiled?.period ?? 0),
    view: "2d",
    labels: true,
    tool: "select",
    draft: [],
    fitRequest: 0,

    load(text) {
      const next = solve(text);
      set({
        ...next,
        syncEvent: "input.canvas",
        step: 0,
        playing: true,
        rate: comfortableRate(next.shown?.compiled?.period ?? 0),
        tool: "select",
        selection: undefined,
        draft: [],
        notice: undefined,
        fitRequest: get().fitRequest + 1,
      });
    },
    edit(text, event = "input.canvas") {
      const next = solve(text, get());
      const count = next.shown?.cycle?.count ?? 1;
      set({ ...next, syncEvent: event, step: Math.min(get().step, count - 1) });
    },
    transact(build, event) {
      const start = editorBridge.text?.() ?? get().text;
      const first = readModel(start).doc;
      if (!first) {
        set({
          notice: "The source has errors. Fix them before changing the model from the drawing.",
        });
        return false;
      }
      // Clear the last complaint; the change itself may raise a new one.
      set({ notice: undefined });
      let text = start;
      const tx: Transaction = {
        doc: first,
        run(edits) {
          text = editText(text, edits);
          const next = readModel(text).doc;
          if (next) tx.doc = next;
        },
      };
      try {
        build(tx);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        set({ notice: error.message });
        return false;
      }
      if (text !== start) get().edit(text, event);
      return true;
    },
    apply: (edits, event) => get().transact((tx) => tx.run(edits), event),
    setStep: (step) => set({ step }),
    setPlaying: (playing) => set({ playing }),
    setRate: (rate) => set({ rate }),
    setView: (view) => set(view === "3d" ? { view, tool: "select", draft: [] } : { view }),
    toggleLabels: () => set({ labels: !get().labels }),
    setTool(tool) {
      // Drawing happens on the flat sheet, at the position the model is written in.
      if (tool === "select") set({ tool, draft: [], notice: undefined });
      else set({ tool, draft: [], notice: undefined, view: "2d", playing: false, step: 0 });
    },
    select(selection) {
      set({ selection });
      if (!selection) return;
      // Show where the selected thing is written, without taking the keyboard away from the drawing.
      const path =
        selection.kind === "joint"
          ? ["joints", selection.id]
          : selection.kind === "body"
            ? ["bodies", selection.id]
            : [
                "bodies",
                selection.ref.split(".")[0] as string,
                "points",
                selection.ref.split(".")[1] as string,
              ];
      const at = readModel(get().text).locate(path);
      if (at) set({ reveal: { ...at, request: (get().reveal?.request ?? 0) + 1, focus: false } });
    },
    setDraft: (draft) => set({ draft }),
    setNotice: (notice) => set({ notice }),
    fit: () => set({ fitRequest: get().fitRequest + 1 }),
    revealAt: (line, col) =>
      set({ reveal: { line, col, request: (get().reveal?.request ?? 0) + 1, focus: true } }),
  };
});
