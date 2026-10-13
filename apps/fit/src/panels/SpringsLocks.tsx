import { label } from "@mekasim/ui";
import { useMemo } from "react";
import { type HoldRow, holdsAt } from "../springs.ts";
import { useStore } from "../store.ts";

function Rows({ title, rows }: { title: string; rows: HoldRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="px-3 pt-2 text-ink-soft text-xs uppercase tracking-wide">{title}</h3>
      <ul className="pb-1">
        {rows.map((row) => (
          <li key={row.key} className="px-3 py-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{label(row.name)}</span>
              <span className="shrink-0 text-right tabular-nums">{row.now}</span>
            </div>
            <div className="text-ink-soft text-sm">{row.about}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The springs, stops and locks of the model, each with how it stands at the step being shown. */
export function SpringsLocks() {
  const shown = useStore((state) => state.shown);
  const step = useStore((state) => Math.round(state.step));
  const { springs, stops, locks } = useMemo(() => holdsAt(shown, step), [shown, step]);
  const none = springs.length + stops.length + locks.length === 0;

  return (
    <section aria-label="Springs and locks" className="border-rule border-b">
      <details open>
        <summary className="cursor-pointer border-rule border-b px-3 py-2 font-semibold">
          Springs and locks
        </summary>
        {none ? (
          <p className="px-3 py-3 text-ink-soft text-sm">
            The model has no springs, stops or locks.
          </p>
        ) : (
          <>
            <Rows title="Springs" rows={springs} />
            <Rows title="Stops" rows={stops} />
            <Rows title="Locks" rows={locks} />
          </>
        )}
      </details>
    </section>
  );
}
