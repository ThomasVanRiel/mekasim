import { toCsv } from "@mekasim/core";
import { useMemo } from "react";
import { Chart } from "../plot/Chart.tsx";
import { buildCharts, buildSweepCharts } from "../plot/charts.ts";
import { PLOT_LEFT, PLOT_PAD } from "../plot/geometry.ts";
import { sweepValues, useStore } from "../store.ts";
import { Timeline } from "./Timeline.tsx";

const button =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm enabled:hover:border-ink-soft disabled:opacity-40";

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Playback, the charts of the model over the cycle, and the export of the motion as a table. */
export function Plots() {
  const shown = useStore((s) => s.shown);
  const sweep = useStore((s) => s.sweep);
  const runs = useStore((s) => s.runs);
  const step = useStore((s) => s.step);
  const apply = useStore((s) => s.apply);
  const charts = useMemo(() => {
    if (sweep && runs) return buildSweepCharts(sweep.param, runs);
    return shown ? buildCharts(shown) : [];
  }, [shown, sweep, runs]);

  const moving = (shown?.cycle?.count ?? 0) > 1;
  /** Charts that stand for plots written in the model can be removed; automatic ones cannot. */
  const own = new Set(shown?.plots.map((plot) => plot.id));
  let message = "";
  if (charts.length === 0)
    message =
      "Nothing to plot yet. Select a point or a link and choose what to plot, or trace a point.";
  else if (sweep)
    message = `Comparing ${sweep.param} at ${sweepValues(sweep)
      .map((v) => (sweep.unit ? `${v} ${sweep.unit}` : v))
      .join(", ")}`;
  else if (own.size === 0)
    message =
      "Showing the traced points and the measures that vary. Select a point or a link to plot something else.";

  function scrub(index: number): void {
    const state = useStore.getState();
    state.setPlaying(false);
    state.setStep(index);
  }

  return (
    <section
      aria-label="Plots"
      className="max-h-[42vh] shrink-0 overflow-y-auto border-rule border-t bg-sheet"
    >
      {/* Playback sits in the same scrolling box as the charts, so that a scrollbar
          narrows both alike and the slider stays in line with them. */}
      <div className="sticky top-0 z-20 border-rule border-b bg-sheet">
        <Timeline
          aside={
            <button
              type="button"
              className={button}
              disabled={!shown?.cycle || !moving}
              onClick={() => {
                if (!shown) return;
                const name = (shown.doc?.meta?.name ?? "model")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-");
                download(`${name}.csv`, toCsv(shown), "text/csv");
              }}
            >
              Export CSV
            </button>
          }
        />
        {message && moving && (
          <p
            className="pb-1.5 text-ink-soft text-sm"
            style={{ paddingLeft: PLOT_PAD + PLOT_LEFT, paddingRight: PLOT_PAD }}
          >
            {message}
          </p>
        )}
      </div>
      {charts.map((spec, i) => (
        <div key={spec.key} className="relative border-rule border-b last:border-b-0">
          <Chart spec={spec} step={step} onScrub={scrub} />
          {own.has(spec.plot) && charts.findIndex((c) => c.plot === spec.plot) === i && (
            <button
              type="button"
              aria-label={`Remove plot ${spec.plot}`}
              title={`Remove plot ${spec.plot}`}
              className="absolute top-1.5 right-3 px-1 text-ink-soft hover:text-red"
              onClick={() => apply([{ op: "delete", path: ["plots", spec.plot] }])}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
