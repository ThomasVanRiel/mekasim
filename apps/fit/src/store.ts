import { type Cycle, type Dim, type Edit, editText, type Files } from "@mekasim/core";
import {
  addContacts,
  asFitText,
  type ContactResult,
  type FitSimulation,
  keepOutlines,
  type RunResult,
  simulate,
  writtenValue,
} from "@mekasim/fit";
import { buildScene, type Scene, withDrawings, withUnit } from "@mekasim/ui";
import { create } from "zustand";
import { DEFAULT_EXAMPLE } from "./examples.ts";
import { motionSolver } from "./motion/solver.ts";
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
  /** The text and drawings `simulation` was solved from; the text may have moved on since. */
  solvedFrom: { text: string; files: Files };
  /** The last version of the model that could be drawn, shown while the text has errors. */
  shown?: FitSimulation;
  scene?: Scene;
  /** The contact row under the pointer, whose closest place is drawn. */
  contact?: ContactResult;
}

/** The model drawn: the new simulation, or the last that could be drawn where it cannot be. */
function solved(
  simulation: FitSimulation,
  solvedFrom: Solved["solvedFrom"],
  before?: Solved & { replay?: Replay },
): Solved & { replay: undefined } {
  const scene = buildScene(simulation);
  // A run of a study being shown gives way to the model as it now is.
  const last = before?.replay?.back ?? before;
  return scene
    ? { simulation, solvedFrom, shown: simulation, scene, contact: undefined, replay: undefined }
    : {
        simulation,
        solvedFrom,
        shown: last?.shown,
        scene: last?.scene,
        contact: undefined,
        replay: undefined,
      };
}

/**
 * The motion is solved in a worker, as it can take seconds, and the rest here once it is
 * known. Where there are no workers (as in Node) all of it is solved here and at once.
 */
const motion =
  typeof Worker === "undefined"
    ? undefined
    : motionSolver(
        () => new Worker(new URL("./motion/worker.ts", import.meta.url), { type: "module" }),
      );

/** Solve the model, and call `done` with it unless newer text has been asked for meanwhile. */
function solveModel(text: string, files: Files, done: (simulation: FitSimulation) => void): void {
  if (!motion) {
    done(simulate(text, files));
    return;
  }
  // Where the worker failed, the model is solved here, which says what went wrong.
  motion.solve(text, files, (answer) =>
    done(simulate(text, files, "cycle" in answer ? answer.cycle : undefined)),
  );
}

/** A model whose motion is still to come: its text read, nothing drawn and nothing said yet. */
const NOT_YET: Cycle = {
  steps: 0,
  count: 0,
  width: 0,
  t: new Float64Array(),
  q: new Float64Array(),
  qd: new Float64Array(),
  qdd: new Float64Array(),
};

/** A run of a study shown on the sheet in place of the model, which is left as it is. */
export interface Replay {
  study: string;
  index: number;
  /** The varied values, in SI. */
  values: Record<string, number>;
  outcome: RunResult["outcome"];
  failed: string[];
  message?: string;
  /** Whether solving it again gave what the study had counted; anything else is a bug. */
  matches: boolean;
  /** What the sheet showed before, to go back to. */
  back: Pick<Solved, "shown" | "scene">;
}

interface State extends Solved {
  text: string;
  /** Whether a newer version of the text is being solved. */
  solving: boolean;
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
  /** Write a new value for a parameter into the source, keeping its bounds. */
  setParam(name: string, value: number | string): void;
  /** Write new values, in SI, for several parameters into the source at once. */
  setValues(values: [name: string, value: number, dim: Dim][]): void;
  /** Add selected contact pairs to the source. Returns how many were new. */
  addContactPairs(pairs: [string, string][]): number;
  /** The study run shown in place of the model, if one is. */
  replay?: Replay;
  /** Show a solved run of a study on the sheet and in the Run tab. */
  showReplay(simulation: FitSimulation, replay: Omit<Replay, "back">): void;
  /** Show the model again. */
  backToModel(): void;
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
  const saved = kept();
  const text = saved ?? DEFAULT_EXAMPLE.text;
  const files = saved === null ? DEFAULT_EXAMPLE.files : keptFiles();
  /**
   * Solve the text and drawings as they now are, and show the result once it comes,
   * with whatever `then` changes besides.
   */
  function resolve(then?: (now: Solved) => Partial<State>): void {
    const { text, files } = get();
    set({ solving: true });
    solveModel(text, files, (simulation) => {
      const now = solved(simulation, { text, files }, get());
      set({ ...now, solving: false, ...then?.(now) });
    });
  }

  // Opened with its drawings, a model plays from its start and the sheet fits it anew.
  const opening = (now: Solved): Partial<State> => ({
    opened: get().opened + 1,
    step: 0,
    playing: true,
    rate: comfortableRate(now.shown?.compiled?.period ?? 0),
  });

  queueMicrotask(() => resolve(opening));
  return {
    ...solved(simulate(text, files, NOT_YET), { text, files }),
    text,
    files,
    solving: true,
    opened: 0,
    step: 0,
    playing: true,
    rate: 1,
    tool: "select",
    load(opened, files = new Map()) {
      // Opened with its drawings, a model takes their outlines into its text at once.
      const next = keepOutlines(opened, files);
      keep(next, files);
      set({ text: next, files });
      resolve(opening);
    },
    attach(picked) {
      const { simulation } = get();
      const added = withDrawings(get().text, simulation.sources, simulation.missing, picked);
      const files = new Map([...get().files, ...added.files]);
      // The outlines the drawings give are kept in the text, where a saved model has them.
      const text = keepOutlines(added.text, files);
      keep(text, files);
      set({ text, files });
      resolve();
    },
    replace(file, drawing) {
      const files = new Map([...get().files, [file, drawing]]);
      const text = keepOutlines(get().text, files);
      keep(text, files);
      set({ text, files });
      resolve();
    },
    setUnit(name, unit) {
      get().setText(keepOutlines(withUnit(get().text, name, unit), get().files));
    },
    setText(next) {
      keep(next, get().files);
      set({ text: next });
      resolve((now) => ({ step: Math.min(get().step, (now.scene?.cycle.count ?? 1) - 1) }));
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
    setParam(name, value) {
      const entry = get().simulation.doc?.params?.[name];
      if (entry === undefined) return;
      const path = typeof entry === "object" ? ["params", name, "value"] : ["params", name];
      get().setText(editText(get().text, [{ op: "set", path, value }]));
    },
    setValues(values) {
      const { doc, compiled } = get().simulation;
      if (!doc || !compiled) return;
      const edits: Edit[] = values.flatMap(([name, value, dim]) => {
        const entry = doc.params?.[name];
        if (entry === undefined) return [];
        const path = typeof entry === "object" ? ["params", name, "value"] : ["params", name];
        return [{ op: "set", path, value: writtenValue(value, dim, compiled.units) }];
      });
      if (edits.length > 0) get().setText(editText(get().text, edits));
    },
    addContactPairs(pairs) {
      const doc = get().simulation.doc;
      if (!doc) {
        set({ notice: "Fix the source before changing contacts from the drawing." });
        return 0;
      }
      const edits: Edit[] = addContacts(doc, pairs);
      if (edits.length > 0) get().setText(editText(asFitText(get().text), edits));
      return edits.length;
    },
    showReplay(simulation, replay) {
      const scene = buildScene(simulation);
      if (!scene) return;
      const back = get().replay?.back ?? { shown: get().shown, scene: get().scene };
      set({
        shown: simulation,
        scene,
        contact: undefined,
        replay: { ...replay, back },
        step: 0,
        playing: true,
      });
    },
    backToModel() {
      const replay = get().replay;
      if (!replay) return;
      const count = replay.back.scene?.cycle.count ?? 1;
      set({ ...replay.back, replay: undefined, step: Math.min(get().step, count - 1) });
    },
  };
});
