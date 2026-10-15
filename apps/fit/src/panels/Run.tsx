import { shownUnit } from "@mekasim/fit";
import { buildCharts, Chart, PLOT_LEFT, PLOT_PAD, PLOT_RIGHT, Splitter, Tabs } from "@mekasim/ui";
import { type CSSProperties, useMemo } from "react";
import { useLayout } from "../layout.ts";
import { RATES } from "../playback.ts";
import { useStore } from "../store.ts";
import { useStudies } from "../study/store.ts";
import { StudyResults } from "./StudyResults.tsx";

/** Width of the slider's marker, as set in the stylesheet. */
const MARKER = 10;

function rateLabel(rate: number): string {
  return rate === 1 ? "Real time" : `1/${Math.round(1 / rate)} speed`;
}

/**
 * The run being shown: playback, laid out on the columns of the charts so that the
 * slider's marker stands over the marker in each of them, and the model's plots.
 */
function RunView() {
  const shown = useStore((s) => s.shown);
  const scene = useStore((s) => s.scene);
  const step = useStore((s) => s.step);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const { setStep, setPlaying, setRate } = useStore.getState();
  const charts = useMemo(() => (shown ? buildCharts(shown, shownUnit) : []), [shown]);

  const count = scene?.cycle.count ?? 0;
  const moving = count > 1;
  const dt = moving && scene ? (scene.cycle.t[1] as number) - (scene.cycle.t[0] as number) : 0;

  function scrub(index: number): void {
    setPlaying(false);
    setStep(index);
  }

  return (
    <>
      <div
        className="sticky top-0 z-20 grid grid-cols-[var(--before)_minmax(0,1fr)_var(--after)] items-center gap-y-1 border-rule border-b bg-sheet py-2"
        style={
          {
            "--before": `${PLOT_PAD + PLOT_LEFT}px`,
            "--after": `${PLOT_RIGHT + PLOT_PAD}px`,
          } as CSSProperties
        }
      >
        <div className="flex justify-center">
          <button
            type="button"
            disabled={!moving}
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? "Pause" : "Play"}
            className="grid size-8 place-items-center rounded-sm border border-ink bg-ink text-sheet disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
              {playing && moving ? (
                <path d="M3 2h4v12H3zM9 2h4v12H9z" />
              ) : (
                <path d="M4 2l10 6-10 6z" />
              )}
            </svg>
          </button>
        </div>
        {moving ? (
          <input
            type="range"
            aria-label="Position in the run"
            // The marker's centre travels half its width short of each end of the input,
            // so the input reaches that much past the plotting area on both sides.
            style={{ marginInline: -MARKER / 2, width: `calc(100% + ${MARKER}px)` }}
            min={0}
            max={count - 1}
            step={1}
            value={Math.min(Math.floor(step), count - 1)}
            onChange={(event) => scrub(Number(event.target.value))}
          />
        ) : (
          <p className="text-ink-soft text-sm">Nothing is driven, so there is no motion to play.</p>
        )}
        <div className="flex justify-end" style={{ paddingRight: PLOT_PAD }}>
          {moving && (
            <select
              aria-label="Playback speed"
              className="rounded-sm border border-rule bg-sheet px-1.5 py-1 text-sm"
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {rateLabel(r)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div />
        <output className="text-sm tabular-nums">
          {moving &&
            `${(step * dt * 1000).toFixed(1)} ms, step ${Math.floor(step) + 1} of ${count}`}
        </output>
      </div>
      {charts.map((spec) => (
        <div key={spec.key} className="border-rule border-b last:border-b-0">
          <Chart spec={spec} step={step} onScrub={scrub} />
        </div>
      ))}
    </>
  );
}

/**
 * The panel under the sheet: the run being shown, and, for a model with studies, what a
 * study came to.
 */
export function Run() {
  const height = useLayout((s) => s.run);
  const resize = useLayout((s) => s.resize);
  const studied = useStore((s) => s.simulation.studies.size > 0);
  const tab = useStudies((s) => (studied ? s.tab : "run"));
  const setTab = useStudies((s) => s.setTab);

  return (
    <>
      <Splitter
        size={height}
        onResize={(size) => resize("run", size)}
        axis="y"
        target="next"
        min={90}
        max={(available) => available * 0.8}
        label="Height of the run panel"
      />
      <section
        aria-label={tab === "run" ? "Run" : "Study"}
        // Its own height once the divider above it has been dragged, and until then that of its content.
        style={{ height: height === undefined ? undefined : `${height}px` }}
        className={`flex shrink-0 flex-col bg-sheet ${height === undefined ? "max-h-[42vh]" : ""}`}
      >
        {studied && (
          <Tabs
            label="Under the drawing"
            tabs={[
              { id: "run", name: "Run" },
              { id: "study", name: "Study" },
            ]}
            current={tab}
            onPick={setTab}
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "run" ? <RunView /> : <StudyResults />}
        </div>
      </section>
    </>
  );
}
