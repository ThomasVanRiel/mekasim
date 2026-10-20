import { describe, expect, it } from "vitest";
import { type FromSolver, motionSolver, type SolverLike, type ToSolver } from "./solver.ts";

/** Workers that answer only when told to, so that requests can overlap. */
function workers() {
  const made: (SolverLike & { asked: ToSolver[]; ended: boolean })[] = [];
  const spawn = (): SolverLike => {
    const worker = {
      asked: [] as ToSolver[],
      ended: false,
      onmessage: null as SolverLike["onmessage"],
      postMessage(message: ToSolver) {
        worker.asked.push(message);
      },
      terminate() {
        worker.ended = true;
      },
    };
    made.push(worker);
    return worker;
  };
  const answer = (worker: SolverLike & { asked: ToSolver[] }, k = -1): void => {
    const { id } = worker.asked.at(k) as ToSolver;
    worker.onmessage?.({ data: { id } } as MessageEvent<FromSolver>);
  };
  return { made, spawn, answer };
}

describe("solving the motion off the page", () => {
  it("keeps one worker while each answer comes before the next request", () => {
    const { made, spawn, answer } = workers();
    const solver = motionSolver(spawn);
    const answers: number[] = [];
    solver.solve("a", new Map(), ({ id }) => answers.push(id));
    answer(made[0] as (typeof made)[number]);
    solver.solve("b", new Map(), ({ id }) => answers.push(id));
    answer(made[0] as (typeof made)[number]);
    expect(made).toHaveLength(1);
    expect(answers).toEqual([1, 2]);
  });

  it("drops the work on older text when newer comes, and answers the newest only", () => {
    const { made, spawn, answer } = workers();
    const solver = motionSolver(spawn);
    const answered: string[] = [];
    solver.solve("a", new Map(), () => answered.push("a"));
    solver.solve("b", new Map(), () => answered.push("b"));
    const [first, second] = made as [(typeof made)[number], (typeof made)[number]];
    expect(first.ended).toBe(true);
    expect(second.asked.map(({ text }) => text)).toEqual(["b"]);
    answer(first);
    answer(second);
    expect(answered).toEqual(["b"]);
  });
});
