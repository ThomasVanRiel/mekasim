import type { Severity } from "@mekasim/core";
import { useState } from "react";
import { useLayout } from "../layout.ts";
import { KIND, messagesText, messageText } from "../messages.ts";
import { useStore } from "../store.ts";

const MARK: Record<Severity, string> = {
  error: "bg-red text-sheet",
  warning: "bg-(--amber) text-ink",
  info: "bg-rule text-ink",
};

const COPY =
  "shrink-0 rounded-sm border border-rule bg-sheet px-1.5 text-[12px] hover:border-ink-soft active:bg-paper";

export function Messages() {
  const diagnostics = useStore((s) => s.simulation.diagnostics);
  const revealAt = useStore((s) => s.revealAt);
  const height = useLayout((s) => s.messages);
  /** Which message was just copied, or all of them, and whether that worked. */
  const [copied, setCopied] = useState<{ what: number | "all"; ok: boolean }>();

  async function copy(what: number | "all", text: string): Promise<void> {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setCopied({ what, ok });
    setTimeout(() => setCopied(undefined), 2000);
  }

  function said(what: number | "all", otherwise: string): string {
    if (copied?.what !== what) return otherwise;
    return copied.ok ? "Copied" : "Could not copy";
  }

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
          {diagnostics.length > 1 && (
            <li className="flex justify-end border-rule border-b px-3 py-1">
              <button
                type="button"
                onClick={() => copy("all", messagesText(diagnostics))}
                className={COPY}
              >
                {said("all", `Copy all ${diagnostics.length}`)}
              </button>
            </li>
          )}
          {diagnostics.map((d, i) => {
            const { position } = d;
            return (
              // A message is a button that goes to its line, so its words cannot be selected
              // with the mouse: the button beside it copies them.
              // biome-ignore lint/suspicious/noArrayIndexKey: messages have no identity of their own
              <li key={i} className="flex items-baseline border-rule border-b pr-3 last:border-b-0">
                <button
                  type="button"
                  disabled={!position}
                  onClick={() => position && revealAt(position.line, position.col)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 py-1.5 pr-2 pl-3 text-left text-sm enabled:hover:bg-paper"
                >
                  <span className={`shrink-0 rounded-sm px-1.5 text-[12px] ${MARK[d.severity]}`}>
                    {KIND[d.severity]}
                  </span>
                  <span className="min-w-0 flex-1">{d.message}</span>
                  {position && (
                    <span className="shrink-0 text-ink-soft tabular-nums">
                      line {position.line}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copy(i, messageText(d))}
                  aria-label={`Copy the message: ${d.message}`}
                  className={COPY}
                >
                  {said(i, "Copy")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
