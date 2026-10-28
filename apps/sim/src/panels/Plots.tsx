import { toCsv } from "@mekasim/core";
import {
  buildCharts,
  buildSweepCharts,
  Chart,
  download,
  fileStem,
  label,
  PLOT_LEFT,
  PLOT_PAD,
  track,
} from "@mekasim/ui";
import { type CSSProperties, useMemo } from "react";
import { useLayout } from "../layout.ts";
import { sweepValues, useStore } from "../store.ts";
import { Timeline } from "./Timeline.tsx";

const button =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm enabled:hover:border-ink-soft disabled:opacity-40";

/**
 * Playback, the charts of the model over the cycle, and the export of the motion as a
 * table.
 */
export function Plots() {
  const shown = useStore((s) => s.shown);
  const sweep = useStore((s) => s.sweep);
  const runs = useStore((s) => s.runs);
  const step = useStore((s) => s.step);
  const apply = useStore((s) => s.apply);
  const height = useLayout((s) => s.plots);
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
    message = `Comparing ${label(sweep.param)} at ${sweepValues(sweep)
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
      // On a wide screen: its own height once the divider above it has been dragged, and
      // until then that of its content. A small screen shows the playback row alone.
      style={{ "--plots": height === undefined ? undefined : `${height}px` } as CSSProperties}
      className={`shrink-0 overflow-y-auto bg-sheet ${
        height === undefined ? "lg:max-h-[42vh]" : "lg:h-[var(--plots)]"
      }`}
    >
      {/* Playback sits in the same scrolling box as the charts, so that a scrollbar
          narrows both alike and the slider stays in line with them. */}
      <div className="sticky top-0 z-20 border-rule border-b bg-sheet">
        <Timeline
          aside={
            <button
              type="button"
              className={`hidden lg:block ${button}`}
              disabled={!shown?.cycle || !moving}
              onClick={() => {
                if (!shown) return;
                download(`${fileStem(shown.doc?.meta?.name)}.csv`, toCsv(shown), "text/csv");
                track("Export CSV");
              }}
            >
              Export CSV
            </button>
          }
        />
        {message && moving && (
          <p
            className="hidden pb-1.5 text-ink-soft text-sm lg:block"
            style={{ paddingLeft: PLOT_PAD + PLOT_LEFT, paddingRight: PLOT_PAD }}
          >
            {message}
          </p>
        )}
      </div>
      {charts.map((spec, i) => (
        <div
          key={spec.key}
          className="relative hidden border-rule border-b last:border-b-0 lg:block"
        >
          <Chart spec={spec} step={step} onScrub={scrub} />
          {own.has(spec.plot) && charts.findIndex((c) => c.plot === spec.plot) === i && (
            <button
              type="button"
              aria-label={`Remove plot ${spec.title}`}
              title={`Remove plot ${spec.title}`}
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
