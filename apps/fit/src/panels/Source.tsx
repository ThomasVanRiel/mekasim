import type { Severity } from "@mekasim/core";
import { useStore } from "../store.ts";

const KIND: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };

const MARK: Record<Severity, string> = {
  error: "bg-red text-sheet",
  warning: "bg-(--amber) text-ink",
  info: "bg-rule text-ink",
};

/**
 * The model's text, and under it what there is to say about it. A plain text field
 * for now: mekasim's editor comes over once it takes its text as a property.
 */
export function Source() {
  const text = useStore((s) => s.text);
  const setText = useStore((s) => s.setText);
  const diagnostics = useStore((s) => s.simulation.diagnostics);

  return (
    <div className="flex min-h-0 flex-col border-rule border-r">
      <h2 className="border-rule border-b px-3 py-1.5 font-semibold">Source</h2>
      <textarea
        aria-label="Source of the model"
        className="min-h-0 flex-1 resize-none bg-sheet px-3 py-2 font-mono text-[13px] leading-relaxed outline-none"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <section aria-label="Messages" className="max-h-[35%] overflow-y-auto border-rule border-t">
        <h2 className="border-rule border-b px-3 py-1.5 font-semibold">Messages</h2>
        {diagnostics.length === 0 ? (
          <p className="px-3 py-2 text-ink-soft text-sm">Nothing to report.</p>
        ) : (
          <ul>
            {diagnostics.map((diagnostic) => (
              <li
                key={`${diagnostic.position?.line} ${diagnostic.message}`}
                className="flex items-baseline gap-2 border-rule border-b px-3 py-1.5 text-sm last:border-b-0"
              >
                <span
                  className={`shrink-0 rounded-sm px-1 text-[12px] ${MARK[diagnostic.severity]}`}
                >
                  {KIND[diagnostic.severity]}
                </span>
                <span className="min-w-0 flex-1">{diagnostic.message}</span>
                {diagnostic.position && (
                  <span className="shrink-0 text-ink-soft tabular-nums">
                    line {diagnostic.position.line}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
