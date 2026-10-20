import type { RunResult } from "@mekasim/fit";
import { create } from "zustand";
import { useStore } from "../store.ts";
import { studyKey } from "./key.ts";
import { startPool, workerCount } from "./pool.ts";
import { replayRun } from "./replay.ts";
import { type KeptResults, savedResults, saveResults } from "./saved.ts";
import type { Filters } from "./view.ts";

/** A study's runs as far as they have gone. */
export interface StudyResults extends KeptResults {
  /** How many runs there are in all. */
  runs: number;
  running: boolean;
  error?: string;
}

/** The results tab redraws at most this often while runs come in. */
const REDRAW = 250;

interface StudiesState {
  /** The latest results of each study, by its name; maybe of an earlier version of the model. */
  current: Record<string, StudyResults>;
  /** The results each had before those, for comparing. */
  before: Record<string, StudyResults>;
  /** The study whose results are shown. */
  selected?: string;
  /** The key of each study of the model as it now is: its results are current under it. */
  keys: Record<string, string>;
  /** Why the shown run could not be solved again, if it could not. */
  notice?: string;
  /** For each study, the ranges its runs are filtered to. */
  filters: Record<string, Filters>;
  /** Filter a study's runs to a range of one parameter, or stop filtering on it. */
  setFilter(study: string, name: string, range: [number, number] | undefined): void;
  clearFilters(study: string): void;
  /** Which tab of the panel under the sheet is open. */
  tab: "run" | "study";
  setTab(tab: "run" | "study"): void;
  select(study: string): void;
  run(study: string): void;
  stop(): void;
  /** Show run `index` of a study on the sheet. */
  show(study: string, index: number): void;
  /** Write a run's values into the model, as a slider would. */
  takeValues(study: string, index: number): void;
}

let stopping: (() => void) | undefined;

export const useStudies = create<StudiesState>((set, get) => {
  /** Put new results in place, and what they replace aside as "before" when they differ. */
  function adopt(results: StudyResults): void {
    const { current, before } = get();
    const last = current[results.study];
    set({
      current: { ...current, [results.study]: results },
      before: last && last.key !== results.key ? { ...before, [results.study]: last } : before,
    });
  }

  /** Change the results of a study, as long as they are still those under `key`. */
  function update(study: string, key: string, change: Partial<StudyResults>): void {
    const last = get().current[study];
    if (last?.key === key) set({ current: { ...get().current, [study]: { ...last, ...change } } });
  }

  return {
    current: {},
    before: {},
    keys: {},
    tab: "run",
    setTab: (tab) => set({ tab }),
    filters: {},
    setFilter(study, name, range) {
      const { [name]: _, ...rest } = get().filters[study] ?? {};
      set({ filters: { ...get().filters, [study]: range ? { ...rest, [name]: range } : rest } });
    },
    clearFilters(study) {
      set({ filters: { ...get().filters, [study]: {} } });
    },
    select: (study) => set({ selected: study }),
    run(study) {
      get().stop();
      const {
        solvedFrom: { text, files },
        simulation,
      } = useStore.getState();
      const plan = simulation.studies.get(study);
      if (!plan) return;
      const key = studyKey(text, files, study);
      const started = performance.now();
      adopt({
        key,
        study,
        plan,
        results: [],
        runs: plan.runs,
        complete: false,
        ms: 0,
        at: Date.now(),
        running: true,
      });
      set({ selected: study, tab: "study" });

      let pending: RunResult[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = (): void => {
        timer = undefined;
        const last = get().current[study];
        if (!last || last.key !== key || pending.length === 0) return;
        update(study, key, {
          results: [...last.results, ...pending],
          ms: performance.now() - started,
        });
        pending = [];
      };
      const finish = (complete: boolean, error?: string): void => {
        if (timer) clearTimeout(timer);
        flush();
        stopping = undefined;
        update(study, key, { running: false, complete, error, at: Date.now() });
        const last = get().current[study];
        if (last?.key === key && last.results.length > 0 && !error) {
          const { running: _, runs: __, error: ___, ...kept } = last;
          void saveResults({
            ...kept,
            results: [...last.results].sort((a, b) => a.index - b.index),
          });
        }
      };
      const pool = startPool(
        { kind: "start", text, files: [...files], study },
        plan.runs,
        workerCount(navigator.hardwareConcurrency),
        () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
        {
          results(results) {
            pending.push(...results);
            timer ??= setTimeout(flush, REDRAW);
          },
          done: () => finish(true),
          error: (message) => finish(false, message),
        },
      );
      stopping = () => {
        pool.stop();
        finish(false);
      };
    },
    stop() {
      stopping?.();
    },
    show(study, index) {
      const shown = get().current[study];
      const counted = shown?.results.find((result) => result.index === index);
      if (!shown || !counted) return;
      const {
        solvedFrom: { text, files },
        simulation,
        showReplay,
      } = useStore.getState();
      if (get().keys[study] !== shown.key) {
        set({
          notice:
            "These results are from an earlier version of the model; run the study again to look at its runs.",
        });
        return;
      }
      const replayed = replayRun(text, simulation, files, shown.plan, counted);
      if ("error" in replayed) {
        set({ notice: replayed.error });
        return;
      }
      set({ notice: undefined });
      const { result, matches } = replayed;
      showReplay(replayed.simulation, {
        study,
        index,
        values: result.values,
        outcome: result.outcome,
        failed: result.failed,
        message: result.message,
        matches,
      });
    },
    takeValues(study, index) {
      const shown = get().current[study];
      const counted = shown?.results.find((result) => result.index === index);
      if (!shown || !counted) return;
      useStore
        .getState()
        .setValues(
          shown.plan.varied.map(({ name, dim }) => [name, counted.values[name] as number, dim]),
        );
    },
  };
});

/** Follow the model: the key of each of its studies, and results kept for them in this browser. */
function follow(): void {
  const {
    solvedFrom: { text, files },
    simulation,
  } = useStore.getState();
  const keys: Record<string, string> = {};
  for (const study of simulation.studies.keys()) keys[study] = studyKey(text, files, study);
  useStudies.setState({ keys });
  const { selected } = useStudies.getState();
  if (!selected || !(selected in keys)) {
    const first = Object.keys(keys)[0];
    if (first) useStudies.setState({ selected: first });
  }
  for (const [study, key] of Object.entries(keys)) {
    if (useStudies.getState().current[study]?.key === key) continue;
    void savedResults(key).then((kept) => {
      // Only if the model has not moved on meanwhile, and nothing newer has been run.
      const state = useStudies.getState();
      if (!kept || state.keys[study] !== key || state.current[study]?.key === key) return;
      if (state.current[study]?.running) return;
      const last = state.current[study];
      useStudies.setState({
        current: { ...state.current, [study]: { ...kept, runs: kept.plan.runs, running: false } },
        before: last && !last.running ? { ...state.before, [study]: last } : state.before,
      });
    });
  }
}

follow();
useStore.subscribe((state, previous) => {
  if (state.simulation !== previous.simulation) follow();
});
