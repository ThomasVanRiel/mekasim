import {
  type FromWorker,
  type RunResult,
  simulate,
  studyWorker,
  type ToWorker,
} from "@mekasim/fit";
import { describe, expect, it } from "vitest";
import { hash, studyKey } from "./key.ts";
import { startPool, type WorkerLike, workerCount } from "./pool.ts";
import { replayRun } from "./replay.ts";

/** A lever pressed by a bar that comes down to `low`; pressed flat when the bar gets to 5 mm. */
const LEVER = `mekafit: 1
params:
  low: { value: 5 mm, min: 0 mm, max: 10 mm }
bodies:
  ground: { points: { O: [0, 0] } }
  lever:
    points: { O: [0, 0] }
    shape: { path: "M 0 -5 H 100 V 5 H 0 Z" }
  bar:
    points: { O: [0, 0] }
    layer: 1
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
joints:
  pin: { type: revolute, connect: [ground.O, lever.O] }
pose:
  bar: [75, 15, 0]
springs:
  up: { joint: pin, stiffness: 0.02 N*m/rad, rest: 30 deg }
drivers:
  press:
    move: bar
    stages:
      - { to: [75, low, 0], time: 1 s }
contacts:
  touch: { between: [lever, bar] }
cycle: { steps: 12 }
checks:
  pressed_flat: min(angle(lever)) < 0.01 deg
studies:
  press: { runs: 20, vary: [low] }
`;

const START: Extract<ToWorker, { kind: "start" }> = { kind: "start", text: LEVER, study: "press" };

/** A worker that answers a little later, as a real one does, from the handler they all run. */
function fakeWorker(ended: { count: number }): WorkerLike {
  const handle = studyWorker();
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message) {
      setTimeout(() => worker.onmessage?.({ data: handle(message) } as MessageEvent<FromWorker>));
    },
    terminate() {
      ended.count++;
    },
  };
  return worker;
}

function runAll(
  start = START,
  runs = 20,
): Promise<{ results: RunResult[]; ended: number; error?: string }> {
  const ended = { count: 0 };
  const results: RunResult[] = [];
  return new Promise((resolve) => {
    startPool(start, runs, 3, () => fakeWorker(ended), {
      results: (batch) => results.push(...batch),
      done: () => resolve({ results, ended: ended.count }),
      error: (error) => resolve({ results, ended: ended.count, error }),
    });
  });
}

describe("keys of kept results", () => {
  it("hash a text to the same and other texts to other keys", () => {
    expect(hash("lever")).toBe(hash("lever"));
    expect(hash("lever")).not.toBe(hash("levers"));
    expect(hash("")).toHaveLength(14);
  });

  it("change with the model, its drawings and the study, not the order of the drawings", () => {
    const files = new Map([
      ["a.dxf", "one"],
      ["b.dxf", "two"],
    ]);
    const key = studyKey(LEVER, files, "press");
    expect(studyKey(LEVER, new Map([...files].reverse()), "press")).toBe(key);
    expect(studyKey(`${LEVER}\n`, files, "press")).not.toBe(key);
    expect(studyKey(LEVER, new Map([...files, ["b.dxf", "three"]]), "press")).not.toBe(key);
    expect(studyKey(LEVER, files, "other")).not.toBe(key);
  });
});

describe("the pool of workers", () => {
  it("starts one fewer than the machine's threads, at least one", () => {
    expect(workerCount(8)).toBe(7);
    expect(workerCount(1)).toBe(1);
    expect(workerCount(undefined)).toBe(1);
  });

  it("runs every run once, ending its workers, to the same results as one at a time", async () => {
    const { results, ended } = await runAll();
    expect(ended).toBe(3);
    const sorted = [...results].sort((a, b) => a.index - b.index);
    expect(sorted.map(({ index }) => index)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const one = studyWorker();
    one(START);
    const alone = one({ kind: "runs", indices: [0, 7, 19] });
    if (alone.kind !== "results") throw new Error("no results");
    for (const result of alone.results) {
      const pooled = sorted[result.index] as RunResult;
      expect({ ...pooled, ms: 0 }).toEqual({ ...result, ms: 0 });
    }
    // Pressed flat when the bar comes to 5 mm or lower: half the range.
    expect(sorted.filter(({ outcome }) => outcome === "passed")).toHaveLength(10);
  });

  it("stops, keeping what has come back", async () => {
    const ended = { count: 0 };
    const results: RunResult[] = [];
    await new Promise<void>((resolve) => {
      const pool = startPool(START, 20, 2, () => fakeWorker(ended), {
        results(batch) {
          results.push(...batch);
          pool.stop();
          resolve();
        },
        done: () => resolve(),
        error: () => resolve(),
      });
    });
    expect(results).toHaveLength(8);
    expect(ended.count).toBe(2);
  });

  it("tells why a study cannot be run", async () => {
    const { error, results } = await runAll({ ...START, study: "nothing" });
    expect(error).toBe('There is no study "nothing"; the model has "press"');
    expect(results).toEqual([]);
  });
});

describe("showing a run again", () => {
  it("gives each run the outcome the study counted", async () => {
    const { results } = await runAll();
    const simulation = simulate(LEVER);
    const plan = simulation.studies.get("press");
    if (!plan) throw new Error("no study");
    for (const counted of results) {
      const replayed = replayRun(LEVER, simulation, new Map(), plan, counted);
      if ("error" in replayed) throw new Error(replayed.error);
      expect(replayed.matches).toBe(true);
      expect(replayed.result.outcome).toBe(counted.outcome);
    }
  });

  it("says so when a run does not come to what was counted", async () => {
    const { results } = await runAll();
    const simulation = simulate(LEVER);
    const plan = simulation.studies.get("press");
    const counted = results[0] as RunResult;
    if (!plan) throw new Error("no study");
    const wrong = {
      ...counted,
      outcome: counted.outcome === "passed" ? "failed" : "passed",
    } as const;
    const replayed = replayRun(LEVER, simulation, new Map(), plan, wrong);
    expect("matches" in replayed && replayed.matches).toBe(false);
  });
});
