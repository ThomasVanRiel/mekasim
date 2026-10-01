import { ANGLE, formatQuantity } from "@mekasim/core";
import { RATES, useStore } from "../store.ts";

function rateLabel(rate: number): string {
  return rate === 1 ? "Real time" : `1/${Math.round(1 / rate)} speed`;
}

export function Timeline() {
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
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-rule border-t px-4 py-2"
    >
      <button
        type="button"
        disabled={!moving}
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-8 place-items-center rounded-sm border border-ink bg-ink text-sheet disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
          {playing && moving ? <path d="M3 2h4v12H3zM9 2h4v12H9z" /> : <path d="M4 2l10 6-10 6z" />}
        </svg>
      </button>
      {moving && compiled ? (
        <>
          <input
            type="range"
            aria-label="Position in the cycle"
            className="min-w-40 flex-1"
            min={0}
            max={count - 1}
            step={1}
            value={Math.min(Math.floor(step), count - 1)}
            onChange={(event) => {
              setPlaying(false);
              setStep(Number(event.target.value));
            }}
          />
          <output className="w-72 text-sm tabular-nums">
            {driver && `${driver.id} at ${formatQuantity(angle, ANGLE, compiled.units, 4)}, `}
            {(time * 1000).toFixed(1)} ms, step {Math.floor(step) + 1} of {count}
          </output>
          <select
            aria-label="Playback speed"
            className="rounded-sm border border-rule bg-sheet px-2 py-1 text-sm"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {rateLabel(r)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="text-ink-soft text-sm">
          Nothing is driven, so there is no motion to play. Add a driver to a revolute joint.
        </p>
      )}
    </section>
  );
}
