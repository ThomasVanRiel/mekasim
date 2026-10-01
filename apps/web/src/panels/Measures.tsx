import { addPlot, formatQuantity, type Quantity, type Units } from "@mekasim/core";
import { useStore } from "../store.ts";

const small = "rounded-sm border border-rule bg-sheet px-1.5 text-[12px] hover:border-ink-soft";

function scalar(quantity: Quantity | undefined, units: Units, digits = 5): string {
  if (!quantity) return "Not available";
  if (typeof quantity.value !== "number") return "varies";
  return formatQuantity(quantity.value, quantity.dim, units, digits);
}

/** The measures of the model: live values, and side by side for each value of a sweep. */
export function Measures() {
  const shown = useStore((s) => s.shown);
  const stale = useStore((s) => s.simulation !== s.shown);
  const step = useStore((s) => Math.floor(s.step));
  const runs = useStore((s) => s.runs);
  const sweep = useStore((s) => s.sweep);
  const apply = useStore((s) => s.apply);
  const transact = useStore((s) => s.transact);
  const units = shown?.compiled?.units;
  const measures = shown?.measures ?? [];
  const partial = shown?.cycle && shown.cycle.count < shown.cycle.steps;

  return (
    <section aria-label="Measures">
      <h2 className="border-rule border-b px-3 py-2 font-semibold">Measures</h2>
      {partial && (
        <p className="border-rule border-b bg-paper px-3 py-1.5 text-sm">
          The motion stops early, so these cover only the {shown.cycle?.count} steps that were
          solved.
        </p>
      )}
      {!units || measures.length === 0 ? (
        <p className="px-3 py-2 text-ink-soft text-sm">
          Nothing is measured yet. Use the Measure tool on the drawing, or add a{" "}
          <code className="font-mono text-[12px]">measures:</code> section to the source, for
          example <code className="font-mono text-[12px]">stroke: range(x(rod.B))</code>.
        </p>
      ) : (
        <dl className={stale ? "opacity-50" : ""}>
          {measures.map(({ id, quantity }) => {
            const value = quantity?.value;
            const signal = typeof value === "object" ? value : undefined;
            return (
              <div key={id} className="border-rule border-b px-3 py-1.5">
                <dt className="flex items-baseline gap-1.5 text-ink-soft text-sm">
                  <span className="min-w-0 flex-1 truncate">{id}</span>
                  {signal && (
                    <button
                      type="button"
                      className={small}
                      onClick={() => transact((tx) => tx.run(addPlot(tx.doc, id, [id]).edits))}
                    >
                      Plot
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove measure ${id}`}
                    className="px-0.5 hover:text-red"
                    onClick={() => apply([{ op: "delete", path: ["measures", id] }])}
                  >
                    ×
                  </button>
                </dt>
                <dd className="text-[17px] tabular-nums leading-tight">
                  {quantity === undefined || value === undefined
                    ? "Not available"
                    : formatQuantity(
                        signal
                          ? (signal[Math.min(step, signal.length - 1)] as number)
                          : (value as number),
                        quantity.dim,
                        units,
                        5,
                      )}
                </dd>
                {quantity && signal && (
                  <dd className="text-ink-soft text-sm tabular-nums">
                    now; over the cycle{" "}
                    {formatQuantity(Math.min(...signal), quantity.dim, units, 4)} to{" "}
                    {formatQuantity(Math.max(...signal), quantity.dim, units, 4)}
                  </dd>
                )}
                {sweep && runs && !signal && (
                  <table className="mt-1 w-full text-sm tabular-nums">
                    <caption className="sr-only">
                      {id} for each value of {sweep.param}
                    </caption>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={String(run.value)} className="border-rule border-t">
                          <th
                            scope="row"
                            className="py-0.5 pr-2 text-left font-normal text-ink-soft"
                          >
                            {sweep.param} = {run.value}
                          </th>
                          <td className="py-0.5 text-right">
                            {scalar(
                              run.simulation.measures.find((m) => m.id === id)?.quantity,
                              units,
                            )}
                          </td>
                        </tr>
                      ))}
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
