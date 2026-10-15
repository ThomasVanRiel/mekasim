import { summarize } from "@mekasim/fit";
import { label } from "@mekasim/ui";
import { useMemo } from "react";
import { useStore } from "../store.ts";
import { useStudies } from "../study/store.ts";
import { progressText, rangeText, rateText, samplingText } from "../study/view.ts";

const button =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft disabled:opacity-40";

/** Where one study stands: running, done, or from an earlier version of the model. */
function Standing({ study }: { study: string }) {
  const runs = useStudies((state) => state.current[study]);
  const current = useStudies((state) => state.keys[study] === state.current[study]?.key);
  const summary = useMemo(() => (runs ? summarize(runs.plan, runs.results) : undefined), [runs]);
  if (!runs || !summary) return <p className="text-ink-soft text-sm">Not run yet.</p>;
  return (
    <div className="text-sm">
      <p className="tabular-nums">{progressText(runs)}</p>
      {runs.results.length > 0 && <p className="tabular-nums">{rateText(summary)}</p>}
      {!current && <p className="text-ink-soft">From an earlier version of the model.</p>}
    </div>
  );
}

/** The model's studies: what each varies and how many runs, with Run and Stop. */
export function Studies() {
  const studies = useStore((state) => state.simulation.studies);
  const units = useStore((state) => state.simulation.compiled?.units);
  const running = useStudies(
    (state) => Object.values(state.current).find((runs) => runs.running)?.study,
  );
  const { run, stop, select } = useStudies.getState();
  const plans = [...studies.values()];

  return (
    <section aria-label="Studies" className="border-rule border-b">
      <details open>
        <summary className="cursor-pointer border-rule border-b px-3 py-2 font-semibold">
          Studies
        </summary>
        {plans.length === 0 || !units ? (
          <p className="px-3 py-3 text-ink-soft text-sm">
            The model has no studies. A study solves it many times over ranges of its parameters and
            counts how often its checks are met.
          </p>
        ) : (
          <ul className="py-1">
            {plans.map((plan) => (
              <li key={plan.name} className="border-rule border-b px-3 py-2 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold text-sm">{label(plan.name)}</span>
                  {running === plan.name ? (
                    <button type="button" className={button} onClick={stop}>
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={button}
                      disabled={running !== undefined}
                      onClick={() => {
                        select(plan.name);
                        run(plan.name);
                      }}
                    >
                      Run
                    </button>
                  )}
                </div>
                <p className="text-ink-soft text-sm">{samplingText(plan)}</p>
                <ul className="my-1 text-sm">
                  {plan.varied.map((varied) => (
                    <li key={varied.name}>
                      {label(varied.name)}: {rangeText(varied, units)}
                    </li>
                  ))}
                </ul>
                {plan.pass && (
                  <p className="text-ink-soft text-sm">
                    Tested by its own conditions: {Object.keys(plan.pass).map(label).join(", ")}
                  </p>
                )}
                <Standing study={plan.name} />
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
