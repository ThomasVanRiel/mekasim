import { editorBridge, type Tool, useStore } from "../store.ts";

const base = "border border-ink px-2.5 py-1 text-sm";
const on = "bg-ink text-sheet";
const off = "bg-sheet hover:bg-paper";

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  {
    id: "select",
    label: "Select",
    key: "v",
    hint: "Click a part to select it. Drag a part to move the mechanism.",
  },
  {
    id: "link",
    label: "Link",
    key: "l",
    hint: "Click to place the points of a new link. Click the last point again, or press Enter, to finish. Points placed on existing points are pinned to them.",
  },
  {
    id: "pin",
    label: "Pin",
    key: "p",
    hint: "Click where two links have a point in common to pin them together, or click a single point to pin it to the ground.",
  },
  {
    id: "motor",
    label: "Motor",
    key: "m",
    hint: "Click a pin to drive it. Click a driven pin to remove its motor.",
  },
  {
    id: "trace",
    label: "Trace",
    key: "t",
    hint: "Click a point to record its path. Click it again to stop.",
  },
  {
    id: "reshape",
    label: "Reshape",
    key: "r",
    hint: "Drag a point to change the shape of its link. Points pinned to it move along.",
  },
];

function segment(index: number, count: number): string {
  if (index === 0) return "rounded-l-sm";
  return index === count - 1 ? "-ml-px rounded-r-sm" : "-ml-px";
}

export function ViewportTools() {
  const view = useStore((s) => s.view);
  const labels = useStore((s) => s.labels);
  const tool = useStore((s) => s.tool);
  const notice = useStore((s) => s.notice);
  const { setView, toggleLabels, fit, setTool } = useStore.getState();
  const active = TOOLS.find((t) => t.id === tool);

  return (
    <div className="pointer-events-none absolute top-3 right-3 left-3 flex flex-col items-start gap-2">
      <div className="pointer-events-auto flex flex-wrap gap-2">
        <fieldset className="flex">
          <legend className="sr-only">View</legend>
          {(["2d", "3d"] as const).map((option, i) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`${base} ${segment(i, 2)} ${view === option ? on : off}`}
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

      <div className="pointer-events-auto flex flex-wrap gap-2">
        <fieldset className="flex">
          <legend className="sr-only">Tool</legend>
          {TOOLS.map((option, i) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={tool === option.id}
              aria-keyshortcuts={option.key}
              title={`${option.label} (${option.key.toUpperCase()})`}
              onClick={() => setTool(option.id)}
              className={`${base} ${segment(i, TOOLS.length)} ${tool === option.id ? on : off}`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <div className="flex">
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            onClick={() => editorBridge.undo?.()}
            className={`${base} rounded-l-sm ${off}`}
          >
            Undo
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Shift+Z)"
            onClick={() => editorBridge.redo?.()}
            className={`${base} -ml-px rounded-r-sm ${off}`}
          >
            Redo
          </button>
        </div>
      </div>

      {(notice || (active && view === "2d")) && (
        <p
          role="status"
          className={`max-w-xl border bg-sheet/95 px-2.5 py-1 text-sm ${notice ? "border-red" : "border-rule"}`}
        >
          {notice ?? active?.hint}
        </p>
      )}
      {view === "3d" && !notice && (
        <p className="max-w-xl border border-rule bg-sheet/95 px-2.5 py-1 text-sm">
          The 3D view is for looking. Drag to turn it, right-drag to move it. Switch to 2D to
          select, move and draw.
        </p>
      )}
    </div>
  );
}
