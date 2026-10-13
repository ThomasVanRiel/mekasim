import { type FitSimulation, shapeBounds, simulate } from "@mekasim/fit";
import { buildScene, type Scene } from "@mekasim/ui";
import { create } from "zustand";
import fourBar from "../../../examples/four-bar.mekasim.yaml?raw";
import { comfortableRate } from "./playback.ts";

const STORAGE_KEY = "mekafit.text";

function kept(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface Solved {
  simulation: FitSimulation;
  /** The last version of the model that could be drawn, shown while the text has errors. */
  shown?: FitSimulation;
  scene?: Scene;
}

function solve(text: string, before?: Solved): Solved {
  const simulation = simulate(text);
  const scene = buildScene(simulation);
  // The outlines reach beyond the points the scene is fitted to.
  if (scene && simulation.compiled) {
    scene.bounds = shapeBounds(
      scene.bounds,
      scene.cycle,
      simulation.compiled.bodies,
      simulation.shapes,
    );
  }
  return scene
    ? { simulation, shown: simulation, scene }
    : { simulation, shown: before?.shown, scene: before?.scene };
}

interface State extends Solved {
  text: string;
  /** Counts the models opened, so that the sheet fits each of them anew. */
  opened: number;
  /** Position in the run, as a sample index with a fraction. */
  step: number;
  playing: boolean;
  rate: number;
  /** Open another model: it replaces this one and plays from its start. */
  load(text: string): void;
  /** Change the text of this model, keeping the place in the run. */
  setText(text: string): void;
  setStep(step: number): void;
  setPlaying(playing: boolean): void;
  setRate(rate: number): void;
}

function keep(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Without storage the model lasts for this visit only.
  }
}

/** The model, its solved run and the playback. Session state only; the model is its text. */
export const useStore = create<State>((set, get) => {
  const text = kept() ?? fourBar;
  const first = solve(text);
  return {
    ...first,
    text,
    opened: 0,
    step: 0,
    playing: true,
    rate: comfortableRate(first.shown?.compiled?.period ?? 0),
    load(next) {
      keep(next);
      const solved = solve(next);
      set({
        ...solved,
        text: next,
        opened: get().opened + 1,
        step: 0,
        playing: true,
        rate: comfortableRate(solved.shown?.compiled?.period ?? 0),
      });
    },
    setText(next) {
      keep(next);
      const solved = solve(next, get());
      const count = solved.scene?.cycle.count ?? 1;
      set({ ...solved, text: next, step: Math.min(get().step, count - 1) });
    },
    setStep: (step) => set({ step }),
    setPlaying: (playing) => set({ playing }),
    setRate: (rate) => set({ rate }),
  };
});
