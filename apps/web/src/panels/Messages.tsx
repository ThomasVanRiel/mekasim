import type { Severity } from "@mekasim/core";
import { useLayout } from "../layout.ts";
import { useStore } from "../store.ts";

const MARK: Record<Severity, { label: string; className: string }> = {
  error: { label: "Error", className: "bg-red text-white" },
  warning: { label: "Warning", className: "bg-[#e3c46a] text-ink" },
  info: { label: "Note", className: "bg-rule text-ink" },
};

export function Messages() {
  const diagnostics = useStore((s) => s.simulation.diagnostics);
  const revealAt = useStore((s) => s.revealAt);
  const height = useLayout((s) => s.messages);

  return (
    <section
      aria-label="Messages"
      style={height === undefined ? undefined : { height, maxHeight: "none" }}
      className="max-h-[32%] shrink-0 overflow-y-auto"
    >
      {diagnostics.length === 0 ? (
        <p className="px-3 py-2 text-ink-soft text-sm">No problems found.</p>
      ) : (
        <ul>
          {diagnostics.map((d, i) => {
            const mark = MARK[d.severity];
            const { position } = d;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages have no identity of their own
              <li key={i} className="border-rule border-b last:border-b-0">
                <button
                  type="button"
                  disabled={!position}
                  onClick={() => position && revealAt(position.line, position.col)}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm enabled:hover:bg-paper"
                >
                  <span className={`shrink-0 rounded-sm px-1.5 text-[12px] ${mark.className}`}>
                    {mark.label}
                  </span>
                  <span className="min-w-0 flex-1">{d.message}</span>
                  {position && (
                    <span className="shrink-0 text-ink-soft tabular-nums">
                      line {position.line}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
