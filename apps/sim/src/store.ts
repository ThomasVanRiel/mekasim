import {
  type Document,
  type Edit,
  EditError,
  editText,
  type Files,
  load as readModel,
  type Simulation,
  type SweepRun,
  simulate,
  sweep as solveSweep,
} from "@mekasim/core";
import { buildScene, LIVE, type Scene, withDrawings } from "@mekasim/ui";
import { create } from "zustand";
import { type Coordinates, SHEET } from "./coordinates.ts";
import { DEFAULT_EXAMPLE } from "./examples.ts";
import type { Hit } from "./viewport/pick.ts";

const STORAGE_KEY = "mekasim.text";
const FILES_KEY = "mekasim.files";

/** Playback speeds relative to real time. */
export const RATES = [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

export type Tool =
  | "select"
  | "link"
  | "pin"
  | "motor"
  | "trace"
  | "reshape"
  | "measure"
  | "crank"
  | "rod"
  | "slot"
  | "tie"
  | "gear"
  | "cam"
  /** Moving the underlay, and picking the two points that set its scale. */
  | "place"
  | "calibrate";

/** A parameter varied over a range, to compare the results side by side. */
export interface Sweep {
  param: string;
  from: number;
  to: number;
  /** Number of values, ends included. */
  count: number;
  /** Unit written after each value, as in `15 mm`; empty for a plain number. */
  unit: string;
}

/** A picture laid under the drawing to trace over. Kept for the session only. */
export interface Underlay {
  url: string;
  /** Size of the picture in pixels. */
  width: number;
  height: number;
  /** Centre of the picture on the sheet, in metres. */
  x: number;
  y: number;
  /** Metres per pixel. */
  scale: number;
  opacity: number;
}

/** The values a sweep runs through. */
export function sweepValues({ from, to, count }: Sweep): number[] {
  return Array.from({ length: count }, (_, i) =>
    Number((from + ((to - from) * i) / Math.max(count - 1, 1)).toPrecision(6)),
  );
}

function runSweep(text: string, sweep: Sweep | undefined, files: Files): SweepRun[] | undefined {
  if (!sweep || readModel(text).doc?.params?.[sweep.param] === undefined) return undefined;
  try {
    return solveSweep(text, sweep.param, sweepValues(sweep), sweep.unit, { files });
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/** Edits that belong to one continuous gesture, such as a drag; they undo as one step. */
export { LIVE };

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

/** The drawings kept with the model from the last visit. */
function storedFiles(): Files {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FILES_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
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
  /** What the cursor in the source is on, shown in the drawing while the source has the keyboard. */
  focus?: Hit;
  /** The points placed so far with the current tool: a link, a distance, a scale. */
  draft: DraftPoint[];
  /** The coordinates that the inspector plots and measures a motion in. */
  coordinates: Coordinates;
  sweep?: Sweep;
  /** The model solved for each value of the sweep. */
  runs?: SweepRun[];
  underlay?: Underlay;
  /** Why the last action did nothing, if it did nothing. */
  notice?: string;
  /** Changes when the view should be fitted to the model again. */
  fitRequest: number;
  /** A place in the text the editor should show. */
  reveal?: { line: number; col: number; request: number; focus: boolean };

  /** The drawings kept with the model, by the file name the model knows each under. */
  files: Files;

  /** Replace the model with new text, as when opening a file, with the drawings that go with it. */
  load(text: string, files?: Files): void;
  /**
   * Add drawings to this model, or put newer ones in place of those it has. A drawing
   * the model does not name yet is written into its `geometry:` section.
   */
  attach(picked: Files): void;
  /** Put a newer file in place of a drawing, under the name the model knows it by. */
  replace(file: string, text: string): void;
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
  setFocus(focus: Hit | undefined): void;
  setDraft(draft: DraftPoint[]): void;
  setNotice(notice: string | undefined): void;
  setCoordinates(coordinates: Coordinates): void;
  setSweep(sweep: Sweep | undefined): void;
  setUnderlay(underlay: Underlay | undefined): void;
  fit(): void;
  revealAt(line: number, col: number): void;
}

type Solved = Pick<State, "text" | "simulation" | "shown" | "scene">;

function solve(text: string, files: Files, previous?: Pick<State, "shown" | "scene">): Solved {
  const simulation = simulate(text, { files });
  const scene = buildScene(simulation);
  try {
    localStorage.setItem(STORAGE_KEY, text);
    localStorage.setItem(FILES_KEY, JSON.stringify(Object.fromEntries(files)));
  } catch {
    // Storage can be unavailable or full; the model still works for this session.
  }
  if (scene) return { text, simulation, shown: simulation, scene };
  return { text, simulation, shown: previous?.shown, scene: previous?.scene };
}

export const useStore = create<State>((set, get) => {
  const kept = stored();
  // The model of the last visit comes back with its drawings; a first visit starts on the example.
  const files = kept === null ? DEFAULT_EXAMPLE.files : storedFiles();
  const initial = solve(kept ?? DEFAULT_EXAMPLE.text, files);
  return {
    ...initial,
    files,
    syncEvent: "input.canvas",
    step: 0,
    playing: true,
    rate: comfortableRate(initial.shown?.compiled?.period ?? 0),
    view: "2d",
    labels: true,
    tool: "select",
    draft: [],
    coordinates: SHEET,
    fitRequest: 0,

    load(text, files = new Map()) {
      const next = solve(text, files);
      set({
        ...next,
        files,
        syncEvent: "input.canvas",
        step: 0,
        playing: true,
        rate: comfortableRate(next.shown?.compiled?.period ?? 0),
        tool: "select",
        selection: undefined,
        draft: [],
        coordinates: SHEET,
        notice: undefined,
        sweep: undefined,
        runs: undefined,
        fitRequest: get().fitRequest + 1,
      });
    },
    attach(picked) {
      const { simulation } = get();
      const added = withDrawings(get().text, simulation.sources, simulation.missing, picked);
      set({ files: new Map([...get().files, ...added.files]) });
      get().edit(added.text);
    },
    replace(file, text) {
      set({ files: new Map([...get().files, [file, text]]) });
      get().edit(get().text);
    },
    edit(text, event = "input.canvas") {
      const next = solve(text, get().files, get());
      const count = next.shown?.cycle?.count ?? 1;
      const runs = runSweep(text, get().sweep, get().files);
      set({
        ...next,
        syncEvent: event,
        step: Math.min(get().step, count - 1),
        runs,
        // A sweep ends when its parameter is gone.
        sweep: runs ? get().sweep : undefined,
      });
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
    setFocus(focus) {
      // The cursor moves often and mostly stays on the same thing; only a change is news.
      if (JSON.stringify(focus) !== JSON.stringify(get().focus)) set({ focus });
    },
    setDraft: (draft) => set({ draft }),
    setNotice: (notice) => set({ notice }),
    setCoordinates: (coordinates) => set({ coordinates }),
    setSweep(sweep) {
      const runs = runSweep(get().text, sweep, get().files);
      set({ sweep: runs ? sweep : undefined, runs });
    },
    setUnderlay(underlay) {
      const previous = get().underlay;
      if (previous && previous.url !== underlay?.url) URL.revokeObjectURL(previous.url);
      const tool = get().tool;
      const idle = !underlay && (tool === "place" || tool === "calibrate");
      set(idle ? { underlay, tool: "select", draft: [] } : { underlay });
    },
    fit: () => set({ fitRequest: get().fitRequest + 1 }),
    revealAt: (line, col) =>
      set({ reveal: { line, col, request: (get().reveal?.request ?? 0) + 1, focus: true } }),
  };
});

// In the dev server, a change to this module or to anything it is built from, such as
// an example file, would make a second store beside the one the open editor writes to.
// The page then no longer follows the source, so start it afresh instead.
import.meta.hot?.accept(() => location.reload());
