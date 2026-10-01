import { docFactor, LENGTH } from "@mekasim/core";
import { useRef, useState } from "react";
import { editorBridge, type Tool, useStore } from "../store.ts";
import { placeUnderlay, rescaleUnderlay } from "../viewport/underlay.ts";

const base = "border border-ink px-2.5 py-1 text-sm";
const on = "bg-ink text-sheet";
const off = "bg-sheet hover:bg-paper";

type Group = "Move" | "Draw" | "Join" | "Drive and measure";

export const TOOLS: { id: Tool; group: Group; label: string; key: string; hint: string }[] = [
  {
    id: "select",
    group: "Move",
    label: "Select",
    key: "v",
    hint: "Click a part to select it. Drag a part to move the mechanism.",
  },
  {
    id: "reshape",
    group: "Move",
    label: "Reshape",
    key: "r",
    hint: "Drag a point to change the shape of its link. Points pinned to it move along.",
  },
  {
    id: "link",
    group: "Draw",
    label: "Link",
    key: "l",
    hint: "Click to place the points of a new link. Click the last point again, or press Enter, to finish. Points placed on existing points are pinned to them.",
  },
  {
    id: "crank",
    group: "Draw",
    label: "Crank",
    key: "c",
    hint: "Click where the crank pivots, then where its arm ends. A pivot placed on an existing point turns about that point; an arm end placed on one is pinned to it.",
  },
  {
    id: "rod",
    group: "Draw",
    label: "Rod",
    key: "o",
    hint: "Click two existing points to join them with a rod of that length.",
  },
  {
    id: "pin",
    group: "Join",
    label: "Pin",
    key: "p",
    hint: "Click where two links have a point in common to pin them together, or click a single point to pin it to the ground.",
  },
  {
    id: "slot",
    group: "Join",
    label: "Slot",
    key: "s",
    hint: "Click the point that should slide, then a second place to give the direction of its line.",
  },
  {
    id: "tie",
    group: "Join",
    label: "Tie",
    key: "i",
    hint: "Click two points to hold them a fixed distance apart.",
  },
  {
    id: "gear",
    group: "Join",
    label: "Gear",
    key: "g",
    hint: "Click the centre each of two bodies turns about to gear them together. Set the sizes, or make it a belt, in the inspector.",
  },
  {
    id: "cam",
    group: "Join",
    label: "Cam",
    key: "a",
    hint: "Click the centre of the cam on its body, then the point of the follower that rides on it. Shape the lift in the inspector.",
  },
  {
    id: "motor",
    group: "Drive and measure",
    label: "Motor",
    key: "m",
    hint: "Click a pin to drive it. Click a driven pin to remove its motor.",
  },
  {
    id: "trace",
    group: "Drive and measure",
    label: "Trace",
    key: "t",
    hint: "Click a point to record its path. Click it again to stop.",
  },
  {
    id: "measure",
    group: "Drive and measure",
    label: "Measure",
    key: "d",
    hint: "Click two points to measure the distance between them, or click a link to measure how far it has moved and turned from where it started. The result is added to the measures.",
  },
];

const GROUPS: Group[] = ["Move", "Draw", "Join", "Drive and measure"];

const UNDERLAY_HINTS: Partial<Record<Tool, string>> = {
  place: "Drag the picture to where it belongs.",
  calibrate:
    "Click two places on the picture whose real distance you know, then enter that distance.",
};

/** Controls for the picture laid under the drawing to trace over. */
function UnderlayControls() {
  const underlay = useStore((s) => s.underlay);
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.draft);
  const units = useStore((s) => s.shown?.compiled?.units);
  const { setUnderlay, setTool, setDraft } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [distance, setDistance] = useState("");

  function open(file: File | undefined): void {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { scene } = useStore.getState();
      if (!scene) return;
      setUnderlay(
        placeUnderlay(
          { url, width: image.naturalWidth, height: image.naturalHeight },
          scene.bounds,
        ),
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      useStore.getState().setNotice("That file could not be read as a picture.");
    };
    image.src = url;
  }

  const [a, b] = draft;
  const real = Number(distance);
  const ready = tool === "calibrate" && a && b && real > 0;

  return (
    <div className="pointer-events-auto hidden flex-wrap items-center gap-2 lg:flex">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`${base} rounded-sm ${off}`}
      >
        {underlay ? "Change picture" : "Trace over a picture"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          open(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {underlay && (
        <>
          <fieldset className="flex">
            <legend className="sr-only">Picture</legend>
            <button
              type="button"
              aria-pressed={tool === "place"}
              onClick={() => setTool(tool === "place" ? "select" : "place")}
              className={`${base} rounded-l-sm ${tool === "place" ? on : off}`}
            >
              Move picture
            </button>
            <button
              type="button"
              aria-pressed={tool === "calibrate"}
              onClick={() => setTool(tool === "calibrate" ? "select" : "calibrate")}
              className={`${base} -ml-px ${tool === "calibrate" ? on : off}`}
            >
              Set its scale
            </button>
            <button
              type="button"
              onClick={() => setUnderlay(undefined)}
              className={`${base} -ml-px rounded-r-sm ${off}`}
            >
              Remove picture
            </button>
          </fieldset>
          <label className="flex items-center gap-1.5 border border-ink bg-sheet px-2 py-0.5 text-sm">
            Strength
            <input
              type="range"
              className="w-24"
              min={0.1}
              max={1}
              step={0.05}
              value={underlay.opacity}
              onChange={(event) =>
                setUnderlay({ ...underlay, opacity: Number(event.target.value) })
              }
            />
          </label>
        </>
      )}
      {underlay && tool === "calibrate" && a && b && (
        <form
          className="flex items-center gap-1.5 border border-ink bg-sheet px-2 py-0.5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !units) return;
            setUnderlay(rescaleUnderlay(underlay, a, b, real * docFactor(LENGTH, units)));
            setDraft([]);
            setDistance("");
            setTool("select");
          }}
        >
          <label className="flex items-center gap-1.5">
            Real distance
            <input
              type="number"
              step="any"
              min="0"
              className="w-24 rounded-sm border border-rule bg-sheet px-1 py-0.5 tabular-nums"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
            />
            {units?.length}
          </label>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-sm border border-ink px-2 disabled:opacity-40"
          >
            Apply
          </button>
        </form>
      )}
    </div>
  );
}

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
  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? UNDERLAY_HINTS[tool];

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

      {/* Drawing and editing need room and a pointer; a small screen only looks. */}
      <div className="pointer-events-auto hidden flex-wrap gap-2 lg:flex">
        {GROUPS.map((group) => {
          const options = TOOLS.filter((option) => option.group === group);
          return (
            <fieldset key={group} className="flex">
              <legend className="sr-only">{group}</legend>
              {options.map((option, i) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={tool === option.id}
                  aria-keyshortcuts={option.key}
                  title={`${option.label} (${option.key.toUpperCase()})`}
                  onClick={() => setTool(option.id)}
                  className={`${base} ${segment(i, options.length)} ${tool === option.id ? on : off}`}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          );
        })}
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

      {view === "2d" && <UnderlayControls />}

      {(notice || (hint && view === "2d")) && (
        <p
          role="status"
          className={`hidden max-w-xl border bg-sheet/95 px-2.5 py-1 text-sm lg:block ${notice ? "border-red" : "border-rule"}`}
        >
          {notice ?? hint}
        </p>
      )}
      {view === "3d" && !notice && (
        <p className="hidden max-w-xl border border-rule bg-sheet/95 px-2.5 py-1 text-sm lg:block">
          The 3D view is for looking. Drag to turn it, right-drag to move it. Switch to 2D to
          select, move and draw.
        </p>
      )}
    </div>
  );
}
