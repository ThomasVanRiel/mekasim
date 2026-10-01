import { useStore } from "../store.ts";

const base = "border border-ink px-2.5 py-1 text-sm";
const on = "bg-ink text-sheet";
const off = "bg-sheet hover:bg-paper";

export function ViewportTools() {
  const view = useStore((s) => s.view);
  const labels = useStore((s) => s.labels);
  const { setView, toggleLabels, fit } = useStore.getState();

  return (
    <div className="absolute top-3 left-3 flex flex-wrap gap-2">
      <fieldset className="flex">
        <legend className="sr-only">View</legend>
        {(["2d", "3d"] as const).map((option, i) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`${base} ${i === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm"} ${view === option ? on : off}`}
          >
            {option === "2d" ? "2D" : "3D"}
          </button>
        ))}
      </fieldset>
      <button type="button" onClick={fit} className={`${base} rounded-sm ${off}`}>
        Fit to window
      </button>
      <button
        type="button"
        aria-pressed={labels}
        onClick={toggleLabels}
        className={`${base} rounded-sm ${labels ? on : off}`}
      >
        Names
      </button>
    </div>
  );
}
