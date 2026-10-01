import { type Simulation, simulate } from "@mekasim/core";
import { create } from "zustand";
import { DEFAULT_EXAMPLE } from "./examples.ts";
import { buildScene, type Scene } from "./viewport/scene.ts";

const STORAGE_KEY = "mekasim.text";

/** Playback speeds relative to real time. */
export const RATES = [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

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

interface State {
  text: string;
  /** Result for the current text. */
  simulation: Simulation;
  /** The last result that could be drawn; stays on screen while the text has errors. */
  shown?: Simulation;
  /** The drawing of `shown`. */
  scene?: Scene;
  /** Position in the cycle as a sample index; fractions fall between samples. */
  step: number;
  playing: boolean;
  /** Playback speed relative to real time. */
  rate: number;
  view: "2d" | "3d";
  labels: boolean;
  /** Changes when the view should be fitted to the model again. */
  fitRequest: number;
  /** Changes when the editor must take over `text`, which it otherwise owns. */
  loadCount: number;
  /** A place in the text the editor should show. */
  reveal?: { line: number; col: number; request: number };

  /** Replace the model with new text, as when opening a file. */
  load(text: string): void;
  /** Take an edit from the editor. */
  edit(text: string): void;
  setStep(step: number): void;
  setPlaying(playing: boolean): void;
  setRate(rate: number): void;
  setView(view: State["view"]): void;
  toggleLabels(): void;
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
    step: 0,
    playing: true,
    rate: comfortableRate(initial.shown?.compiled?.period ?? 0),
    view: "2d",
    labels: true,
    fitRequest: 0,
    loadCount: 0,

    load(text) {
      const next = solve(text);
      set({
        ...next,
        step: 0,
        playing: true,
        rate: comfortableRate(next.shown?.compiled?.period ?? 0),
        fitRequest: get().fitRequest + 1,
        loadCount: get().loadCount + 1,
      });
    },
    edit(text) {
      const next = solve(text, get());
      const count = next.shown?.cycle?.count ?? 1;
      set({ ...next, step: Math.min(get().step, count - 1) });
    },
    setStep: (step) => set({ step }),
    setPlaying: (playing) => set({ playing }),
    setRate: (rate) => set({ rate }),
    setView: (view) => set({ view }),
    toggleLabels: () => set({ labels: !get().labels }),
    fit: () => set({ fitRequest: get().fitRequest + 1 }),
    revealAt: (line, col) =>
      set({ reveal: { line, col, request: (get().reveal?.request ?? 0) + 1 } }),
  };
});
