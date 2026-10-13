import { type Files, type FitSimulation, simulate } from "@mekasim/fit";
import { buildScene, type Scene } from "@mekasim/ui";
import { create } from "zustand";
import fourBar from "../../../examples/four-bar.mekasim.yaml?raw";
import { comfortableRate } from "./playback.ts";

const STORAGE_KEY = "mekafit.text";
const FILES_KEY = "mekafit.files";

function kept(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function keptFiles(): Files {
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

interface Solved {
  simulation: FitSimulation;
  /** The last version of the model that could be drawn, shown while the text has errors. */
  shown?: FitSimulation;
  scene?: Scene;
}

function solve(text: string, files: Files, before?: Solved): Solved {
  const simulation = simulate(text, files);
  const scene = buildScene(simulation);
  return scene
    ? { simulation, shown: simulation, scene }
    : { simulation, shown: before?.shown, scene: before?.scene };
}

interface State extends Solved {
  text: string;
  /** The drawings kept with the model, by the name the model knows each under. */
  files: Files;
  /** Counts the models opened, so that the sheet fits each of them anew. */
  opened: number;
  /** Position in the run, as a sample index with a fraction. */
  step: number;
  playing: boolean;
  rate: number;
  /** Open another model, with its drawings: it replaces this one and plays from its start. */
  load(text: string, files?: Files): void;
  /** Add drawings to this model, or put newer ones in place of those of the same name. */
  attach(files: Files): void;
  /** Change the text of this model, keeping the place in the run. */
  setText(text: string): void;
  setStep(step: number): void;
  setPlaying(playing: boolean): void;
  setRate(rate: number): void;
}

function keep(text: string, files: Files): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
    localStorage.setItem(FILES_KEY, JSON.stringify(Object.fromEntries(files)));
  } catch {
    // Without storage, or with drawings too large for it, the model lasts for this visit only.
  }
}

/** The model, its solved run and the playback. Session state only; the model is its text. */
export const useStore = create<State>((set, get) => {
  const text = kept() ?? fourBar;
  const files = keptFiles();
  const first = solve(text, files);
  return {
    ...first,
    text,
    files,
    opened: 0,
    step: 0,
    playing: true,
    rate: comfortableRate(first.shown?.compiled?.period ?? 0),
    load(next, files = new Map()) {
      keep(next, files);
      const solved = solve(next, files);
      set({
        ...solved,
        text: next,
        files,
        opened: get().opened + 1,
        step: 0,
        playing: true,
        rate: comfortableRate(solved.shown?.compiled?.period ?? 0),
      });
    },
    attach(added) {
      const files = new Map([...get().files, ...added]);
      keep(get().text, files);
      set({ ...solve(get().text, files, get()), files });
    },
    setText(next) {
      keep(next, get().files);
      const solved = solve(next, get().files, get());
      const count = solved.scene?.cycle.count ?? 1;
      set({ ...solved, text: next, step: Math.min(get().step, count - 1) });
    },
    setStep: (step) => set({ step }),
    setPlaying: (playing) => set({ playing }),
    setRate: (rate) => set({ rate }),
  };
});
