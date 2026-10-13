import { label } from "@mekasim/ui";
import { type CheckOutcome, checkOutcome, checkSummary } from "../checks.ts";
import { useStore } from "../store.ts";

const small = "rounded-sm border border-rule bg-sheet px-1.5 text-[12px] hover:border-ink-soft";

/** A tick or a cross, so that the two differ in shape as well as in colour. */
function Mark({ state }: { state: CheckOutcome["state"] }) {
  if (state === "not available") return <span className="w-3.5 text-center text-ink-soft">–</span>;
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 self-center fill-none stroke-2 ${
        state === "met" ? "stroke-dye" : "stroke-red"
      }`}
    >
      <path d={state === "met" ? "M2 7.5 5.5 11 12 3" : "M3 3l8 8M11 3l-8 8"} />
    </svg>
  );
}

const WORDS: Record<CheckOutcome["state"], string> = {
  met: "Met",
  "not met": "Not met",
  "not available": "Not available",
};

/** The checks of the model: whether each is met, and for each value of a sweep. */
export function Checks() {
  const shown = useStore((s) => s.shown);
  const stale = useStore((s) => s.simulation !== s.shown);
  const runs = useStore((s) => s.runs);
  const sweep = useStore((s) => s.sweep);
  const apply = useStore((s) => s.apply);
  const checks = shown?.checks ?? [];
  const written = shown?.doc?.checks ?? {};
  const steps = shown?.cycle?.count ?? 0;

  return (
    <section aria-label="Checks" className="border-rule border-t">
      <h2 className="flex items-baseline gap-2 border-rule border-b px-3 py-2 font-semibold">
        <span className="flex-1">Checks</span>
        <span className="font-normal text-ink-soft text-sm">{checkSummary(checks)}</span>
      </h2>
      {checks.length === 0 ? (
        <p className="px-3 py-2 text-ink-soft text-sm">
          Nothing is checked yet. Add a <code className="font-mono text-[12px]">checks:</code>{" "}
          section to the source with what the motion has to meet, for example{" "}
          <code className="font-mono text-[12px]">long_enough: range(x(rod.B)) &gt; 50 mm</code>.
        </p>
      ) : (
        <dl className={stale ? "opacity-50" : ""}>
          {checks.map((check) => {
            const { id } = check;
            const outcome = checkOutcome(check, steps);
            return (
              <div key={id} className="border-rule border-b px-3 py-1.5">
                <dt className="flex items-baseline gap-1.5 text-sm">
                  <Mark state={outcome.state} />
                  <span className="min-w-0 flex-1 truncate">{label(id)}</span>
                  <span className={outcome.state === "not met" ? "text-red" : "text-ink-soft"}>
                    {WORDS[outcome.state]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove check ${label(id)}`}
                    className="px-0.5 text-ink-soft hover:text-red"
                    onClick={() => apply([{ op: "delete", path: ["checks", id] }])}
                  >
                    ×
                  </button>
                </dt>
                <dd
                  className="truncate pl-5 font-mono text-[12px] text-ink-soft"
                  title={written[id]}
                >
                  {written[id]}
                </dd>
                {outcome.where && (
                  <dd className="flex items-baseline gap-1.5 pl-5 text-sm">
                    <span className="flex-1">{outcome.where}</span>
                    {outcome.step !== undefined && (
                      <button
                        type="button"
                        className={small}
                        onClick={() => {
                          const { setPlaying, setStep } = useStore.getState();
                          setPlaying(false);
                          setStep(outcome.step as number);
                        }}
                      >
                        Show
                      </button>
                    )}
                  </dd>
                )}
                {sweep && runs && (
                  <table className="mt-1 w-full text-sm">
                    <caption className="sr-only">
                      {label(id)} for each value of {label(sweep.param)}
                    </caption>
                    <tbody>
                      {runs.map((run) => {
                        const state = checkOutcome(
                          run.simulation.checks.find((c) => c.id === id),
                          run.simulation.cycle?.count ?? 0,
                        ).state;
                        return (
                          <tr key={String(run.value)} className="border-rule border-t">
                            <th
                              scope="row"
                              className="py-0.5 pr-2 text-left font-normal text-ink-soft tabular-nums"
                            >
                              {label(sweep.param)} = {run.value}
                            </th>
                            <td className="py-0.5">
                              <span className="flex items-baseline justify-end gap-1.5">
                                <Mark state={state} />
                                {WORDS[state]}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
