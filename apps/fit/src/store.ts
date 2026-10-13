import { type Edit, editText, type Files } from "@mekasim/core";
import {
  addContacts,
  type ContactResult,
  type FitSimulation,
  keepOutlines,
  simulate,
} from "@mekasim/fit";
import { buildScene, type Scene, withDrawings, withUnit } from "@mekasim/ui";
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
  /** The contact row under the pointer, whose closest place is drawn. */
  contact?: ContactResult;
}

function solve(text: string, files: Files, before?: Solved): Solved {
  const simulation = simulate(text, files);
  const scene = buildScene(simulation);
  return scene
    ? { simulation, shown: simulation, scene, contact: undefined }
    : { simulation, shown: before?.shown, scene: before?.scene, contact: undefined };
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
  tool: "select" | "contact";
  /** The first body picked by the Contact tool. */
  contactDraft?: string;
  /** A short explanation when a drawing action cannot be completed yet. */
  notice?: string;
  /** Open another model, with its drawings: it replaces this one and plays from its start. */
  load(text: string, files?: Files): void;
  /**
   * Add drawings to this model, or put newer ones in place of those it has. A drawing
   * the model does not name yet is written into its `geometry:` section.
   */
  attach(picked: Files): void;
  /** Put a newer file in place of a drawing, under the name the model knows it by. */
  replace(file: string, text: string): void;
  /** Say what unit a drawing is in, for one whose file does not. */
  setUnit(name: string, unit: "mm" | "cm" | "m" | "in"): void;
  /** Change the text of this model, keeping the place in the run. */
  setText(text: string): void;
  setStep(step: number): void;
  setPlaying(playing: boolean): void;
  setRate(rate: number): void;
  /** Show a contact at its closest step while its row is under the pointer or keyboard focus. */
  showContact(contact?: ContactResult): void;
  setTool(tool: State["tool"]): void;
  pickContact(body: string): void;
  /** Add selected contact pairs to the source. Returns how many were new. */
  addContactPairs(pairs: [string, string][]): number;
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
    tool: "select",
    load(opened, files = new Map()) {
      // Opened with its drawings, a model takes their outlines into its text at once.
      const next = keepOutlines(opened, files);
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
    attach(picked) {
      const { simulation } = get();
      const added = withDrawings(get().text, simulation.sources, simulation.missing, picked);
      const files = new Map([...get().files, ...added.files]);
      // The outlines the drawings give are kept in the text, where a saved model has them.
      const text = keepOutlines(added.text, files);
      keep(text, files);
      set({ ...solve(text, files, get()), text, files });
    },
    replace(file, drawing) {
      const files = new Map([...get().files, [file, drawing]]);
      const text = keepOutlines(get().text, files);
      keep(text, files);
      set({ ...solve(text, files, get()), text, files });
    },
    setUnit(name, unit) {
      get().setText(keepOutlines(withUnit(get().text, name, unit), get().files));
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
    showContact(contact) {
      set(contact ? { contact, step: contact.step, playing: false } : { contact: undefined });
    },
    setTool(tool) {
      set({ tool, contactDraft: undefined, notice: undefined });
    },
    pickContact(body) {
      const first = get().contactDraft;
      if (!first) {
        set({ contactDraft: body, notice: "Now click the other part." });
        return;
      }
      if (first === body) {
        set({ notice: "Choose a different part." });
        return;
      }
      const added = get().addContactPairs([[first, body]]);
      set({
        contactDraft: undefined,
        notice: added ? undefined : "Those parts are already listed.",
      });
    },
    addContactPairs(pairs) {
      const doc = get().simulation.doc;
      if (!doc) {
        set({ notice: "Fix the source before changing contacts from the drawing." });
        return 0;
      }
      const edits: Edit[] = addContacts(doc, pairs);
      if (edits.length > 0) get().setText(editText(get().text, edits));
      return edits.length;
    },
  };
});
