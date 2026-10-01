import { ANGLE, formatQuantity } from "@mekasim/core";
import type { ReactNode } from "react";
import { label } from "../names.ts";
import { PLOT_LEFT, PLOT_PAD, PLOT_RIGHT } from "../plot/geometry.ts";
import { RATES, useStore } from "../store.ts";

/** Width of the slider's marker, as set in the stylesheet. */
const MARKER = 10;

function rateLabel(rate: number): string {
  return rate === 1 ? "Real time" : `1/${Math.round(1 / rate)} speed`;
}

/**
 * Playback controls, laid out on the same columns as the charts below them: the
 * slider spans exactly the plotting area, so its marker stands over the same
 * position in the cycle as the marker in every chart.
 */
export function Timeline({ aside }: { aside?: ReactNode }) {
  const scene = useStore((s) => s.scene);
  const compiled = useStore((s) => s.shown?.compiled);
  const step = useStore((s) => s.step);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const { setStep, setPlaying, setRate } = useStore.getState();

  const count = scene?.cycle.count ?? 0;
  const moving = count > 1;
  const dt = moving && scene ? scene.cycle.t[1] - scene.cycle.t[0] : 0;
  const time = step * dt;
  const driver = compiled?.drivers[0];
  const turn = 2 * Math.PI;
  const angle = driver ? (((driver.phase + driver.speed * time) % turn) + turn) % turn : 0;

  return (
    <section
      aria-label="Playback"
      className="grid items-center gap-y-1 py-2"
      style={{
        gridTemplateColumns: `${PLOT_PAD + PLOT_LEFT}px minmax(0, 1fr) ${PLOT_RIGHT + PLOT_PAD}px`,
      }}
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

      {moving && compiled ? (
        <input
          type="range"
          aria-label="Position in the cycle"
          // The marker's centre travels half its width short of each end of the input,
          // so the input reaches that much past the plotting area on both sides.
          style={{ marginInline: -MARKER / 2, width: `calc(100% + ${MARKER}px)` }}
          min={0}
          max={count - 1}
          step={1}
          value={Math.min(Math.floor(step), count - 1)}
          onChange={(event) => {
            setPlaying(false);
            setStep(Number(event.target.value));
          }}
        />
      ) : (
        <p className="text-ink-soft text-sm">
          Nothing is driven, so there is no motion to play. Add a motor to a pin.
        </p>
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
        {moving && compiled && (
          <>
            {driver &&
              `${label(driver.id)} at ${formatQuantity(angle, ANGLE, compiled.units, 4)}, `}
            {(time * 1000).toFixed(1)} ms, step {Math.floor(step) + 1} of {count}
          </>
        )}
      </output>
      <div className="flex justify-end" style={{ paddingRight: PLOT_PAD }}>
        {aside}
      </div>
    </section>
  );
}
