import type { Severity } from "@mekasim/core";
import { SourceEditor, Splitter } from "@mekasim/ui";
import { useState } from "react";
import { useLayout } from "../layout.ts";
import { useStore } from "../store.ts";
import { Geometry } from "./Geometry.tsx";

const KIND: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };

const MARK: Record<Severity, string> = {
  error: "bg-red text-sheet",
  warning: "bg-(--amber) text-ink",
  info: "bg-rule text-ink",
};

const TABS = [
  ["source", "Source"],
  ["geometry", "Geometry"],
] as const;

/**
 * The left panel: the model's text in the editor mekasim has too, or its drawings,
 * and under both what there is to say about the model.
 */
export function Source() {
  const text = useStore((s) => s.text);
  const setText = useStore((s) => s.setText);
  const diagnostics = useStore((s) => s.simulation.diagnostics);
  const height = useLayout((s) => s.messages);
  const resize = useLayout((s) => s.resize);
  const missing = useStore((s) => s.simulation.missing.length);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("source");

  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Model" className="flex border-rule border-b">
        {TABS.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 font-semibold ${
              tab === id ? "border-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {name}
            {/* A drawing the model names is not here: say so where it can be put right. */}
            {id === "geometry" && missing > 0 && (
              <span className="ml-1.5 rounded-sm bg-(--amber) px-1 font-normal text-[12px] text-ink">
                {missing} missing
              </span>
            )}
          </button>
        ))}
      </div>
      {/* The editor stays in being under the other tab, with its cursor and its undo history. */}
      <div className={`relative min-h-0 flex-1 ${tab === "source" ? "" : "hidden"}`}>
        <div className="absolute inset-0">
          <SourceEditor text={text} diagnostics={diagnostics} onEdit={setText} />
        </div>
      </div>
      {tab === "geometry" && <Geometry />}
      <Splitter
        size={height}
        onResize={(size) => resize("messages", size)}
        axis="y"
        target="next"
        min={34}
        max={(available) => available * 0.6}
        label="Height of the messages"
      />
      <section
        aria-label="Messages"
        style={{ height: height === undefined ? undefined : `${height}px` }}
        className={`shrink-0 overflow-y-auto ${height === undefined ? "max-h-[35%]" : ""}`}
      >
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
