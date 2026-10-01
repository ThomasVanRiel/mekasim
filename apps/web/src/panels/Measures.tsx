import { formatQuantity } from "@mekasim/core";
import { useStore } from "../store.ts";

export function Measures() {
  const shown = useStore((s) => s.shown);
  const stale = useStore((s) => s.simulation !== s.shown);
  const step = useStore((s) => Math.floor(s.step));
  const units = shown?.compiled?.units;
  const measures = shown?.measures ?? [];
  const partial = shown?.cycle && shown.cycle.count < shown.cycle.steps;

  return (
    <section aria-label="Measures" className="flex min-h-0 flex-col">
      <h2 className="border-rule border-b px-3 py-2 font-semibold">Measures</h2>
      {partial && (
        <p className="border-rule border-b bg-paper px-3 py-1.5 text-sm">
          The motion stops early, so these cover only the {shown.cycle?.count} steps that were
          solved.
        </p>
      )}
      {!units || measures.length === 0 ? (
        <p className="px-3 py-2 text-ink-soft text-sm">
          Nothing is measured yet. Add a <code className="font-mono text-[12px]">measures:</code>{" "}
          section to the source, for example{" "}
          <code className="font-mono text-[12px]">stroke: range(x(rod.B))</code>.
        </p>
      ) : (
        <dl className={`min-h-0 overflow-y-auto ${stale ? "opacity-50" : ""}`}>
          {measures.map(({ id, quantity }) => {
            const value = quantity?.value;
            const signal = typeof value === "object" ? value : undefined;
            return (
              <div key={id} className="border-rule border-b px-3 py-1.5">
                <dt className="text-ink-soft text-sm">{id}</dt>
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
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
