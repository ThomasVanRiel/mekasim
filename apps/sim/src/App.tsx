import { BESIDE_FOLD, decodeModel, exampleIn, Geometry, Tabs } from "@mekasim/ui";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { SourceEditor } from "./editor/SourceEditor.tsx";
import { EXAMPLES } from "./examples.ts";
import { useLayout } from "./layout.ts";
import { Checks } from "./panels/Checks.tsx";
import { Header } from "./panels/Header.tsx";
import { HELP_ID, Help } from "./panels/Help.tsx";
import { Inspector } from "./panels/Inspector.tsx";
import { Measures } from "./panels/Measures.tsx";
import { Messages } from "./panels/Messages.tsx";
import { Parameters } from "./panels/Parameters.tsx";
import { Plots } from "./panels/Plots.tsx";
import { SKILL_ID, Skill } from "./panels/Skill.tsx";
import { Splitter } from "./panels/Splitter.tsx";
import { TitleBlock } from "./panels/TitleBlock.tsx";
import { TOOLS, ViewportTools } from "./panels/ViewportTools.tsx";
import { editorBridge, useStore } from "./store.ts";
import { deleteSelection, finishLink } from "./viewport/tools.ts";
import { Viewport } from "./viewport/Viewport.tsx";

/**
 * Whether a key belongs to what has the focus rather than to the drawing: text being
 * typed, or a control reached with the keyboard. A control that was only clicked is
 * done with, and holds on to no keys.
 */
function keepsKey(control: Element | null, key: string, reached: boolean): boolean {
  if (!control) return false;
  if (control.matches("textarea, .cm-editor")) return true;
  // A slider moves with the arrow keys and has no use for Space.
  if (control.matches('input[type="range"]')) return key !== " ";
  if (control.matches("input")) return true;
  // Not `:focus-visible`: a list that was clicked matches it in some browsers.
  if (!reached) return false;
  return control.matches("select") || key === " " || key === "Enter";
}

/**
 * Keyboard shortcuts for the drawing, active unless a control or the editor has the
 * keys: Space plays and pauses, the arrow keys step, letters pick tools, Enter and
 * Esc finish and cancel, Delete removes the selection, Ctrl+Z undoes.
 */
function useKeys(): void {
  useEffect(() => {
    /** Whether the focus was last moved with Tab rather than by a click. */
    let reached = false;
    function onPointer(): void {
      reached = false;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Tab") reached = true;
      const target = event.target as HTMLElement;
      const control = target.closest<HTMLElement>("input, select, button, textarea, .cm-editor");
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (keepsKey(control, key, reached)) return;
      const state = useStore.getState();
      const count = state.scene?.cycle.count ?? 0;
      const tool = TOOLS.find((t) => t.key === key);

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        if (event.shiftKey) editorBridge.redo?.();
        else editorBridge.undo?.();
      } else if ((event.ctrlKey || event.metaKey) && key === "y") {
        editorBridge.redo?.();
      } else if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      } else if (key === " " && count > 1) {
        state.setPlaying(!state.playing);
      } else if ((key === "ArrowRight" || key === "ArrowLeft") && count > 1) {
        const direction = key === "ArrowRight" ? 1 : -1;
        state.setPlaying(false);
        state.setStep((Math.floor(state.step) + direction + count) % count);
      } else if (key === "Enter" && state.tool === "link") {
        finishLink();
      } else if (key === "Escape") {
        if (state.draft.length > 0) state.setDraft([]);
        else if (state.tool !== "select") state.setTool("select");
        else state.select(undefined);
      } else if (key === "Delete" || key === "Backspace") {
        deleteSelection();
      } else if (tool) {
        state.setTool(tool.id);
      } else {
        return;
      }
      event.preventDefault();
      // A clicked button or list would otherwise answer the key as well, when it is let go.
      if (control?.matches("button, select")) control.blur();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
}

/**
 * A model that arrives in the link replaces the one kept from the last visit: either
 * the whole model packed into the link, or the name of a built-in example.
 */
function useLinkedModel(): void {
  const text = useStore((s) => s.text);

  useEffect(() => {
    function open(): void {
      const example = EXAMPLES.find((e) => e.id === exampleIn(location.hash));
      if (example) {
        // The link stays in the address bar, so that it can be copied from there.
        if (useStore.getState().text !== example.text) {
          useStore.getState().load(example.text, example.files);
        }
        return;
      }
      decodeModel(location.hash).then((packed) => {
        if (packed === undefined) return;
        useStore.getState().load(packed);
        history.replaceState(null, "", location.pathname + location.search);
      });
    }
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // Once the model is changed it is no longer the example the address names.
  useEffect(() => {
    const example = EXAMPLES.find((e) => e.id === exampleIn(location.hash));
    if (example && example.text !== text) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [text]);
}

/** A button above the source that folds a panel open beside it, and shut again. */
function FoldButton({
  controls,
  open,
  onClick,
  title,
  children,
}: {
  /** The id of the panel it opens. */
  controls: string;
  open: boolean;
  onClick(): void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft active:bg-paper"
    >
      {children}
      <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden="true">
        {open ? <path d="M11 2 5 8l6 6z" /> : <path d="M5 2l6 6-6 6z" />}
      </svg>
    </button>
  );
}

export function App() {
  const hasDrawing = useStore((s) => s.scene !== undefined);
  const stale = useStore((s) => s.simulation !== s.shown);
  const source = useLayout((s) => s.source);
  const side = useLayout((s) => s.side);
  const help = useLayout((s) => s.help);
  const setHelp = useLayout((s) => s.setHelp);
  const skill = useLayout((s) => s.skill);
  const setSkill = useLayout((s) => s.setSkill);
  const [tab, setTab] = useState<"source" | "geometry">("source");
  const missing = useStore((s) => s.simulation.unshaped.length);
  const sources = useStore((s) => s.simulation.sources);
  const drawings = useStore((s) => s.simulation.drawings);
  const uses = useStore((s) => s.simulation.uses);
  const files = useStore((s) => s.files);
  useKeys();
  useLinkedModel();
  // Column widths, as set by dragging the dividers or else the defaults.
  const columns = {
    "--source": source === undefined ? "minmax(20rem, 28%)" : `${source}px`,
    "--side": side === undefined ? "19rem" : `${side}px`,
  } as CSSProperties;

  return (
    <div
      style={columns}
      className="relative flex h-full flex-col lg:grid lg:grid-cols-[var(--source)_auto_minmax(0,1fr)_auto_var(--side)] lg:grid-rows-[auto_minmax(0,1fr)]"
    >
      <div className="lg:col-span-5">
        <Header />
        {/* A small screen shows the mechanism moving and nothing else. */}
        <p className="border-rule border-b bg-paper px-4 py-1.5 text-sm lg:hidden">
          On a screen this size you can watch the mechanism move. Open this page on a larger screen
          for the full editor.
        </p>
      </div>

      <div className="hidden min-h-0 flex-col lg:flex" {...{ [BESIDE_FOLD]: "" }}>
        <Tabs<"source" | "geometry">
          label="Model"
          current={tab}
          onPick={setTab}
          tabs={[
            { id: "source", name: "Source" },
            // A drawing the model names is not here: say so where it can be put right.
            {
              id: "geometry",
              name: "Geometry",
              note: missing > 0 ? "drawing missing" : undefined,
            },
          ]}
        >
          <div className="flex gap-1.5 pr-2">
            <FoldButton
              controls={SKILL_ID}
              open={skill}
              onClick={() => setSkill(!skill)}
              title="A text that teaches an AI assistant to write models for you"
            >
              {skill ? "Close skill" : "AI skill"}
            </FoldButton>
            <FoldButton controls={HELP_ID} open={help} onClick={() => setHelp(!help)}>
              {help ? "Close help" : "Help"}
            </FoldButton>
          </div>
        </Tabs>
        {/* The editor stays in being under the other tab, with its cursor and its undo history. */}
        <div className={`relative min-h-0 flex-1 ${tab === "source" ? "" : "hidden"}`}>
          <div className="absolute inset-0">
            <SourceEditor />
          </div>
        </div>
        {tab === "geometry" && (
          <Geometry
            sources={sources}
            drawings={drawings}
            uses={uses}
            files={files}
            onAdd={(picked) => useStore.getState().attach(picked)}
            onReplace={(file, text) => useStore.getState().replace(file, text)}
            onUnit={(name, unit) => useStore.getState().setUnit(name, unit)}
          />
        )}
        <Splitter
          panel="messages"
          axis="y"
          target="next"
          min={34}
          max={(height) => height * 0.6}
          label="Height of the messages"
        />
        <Messages />
      </div>
      <Splitter
        panel="source"
        axis="x"
        target="previous"
        min={220}
        max={(width) => width * 0.6}
        label="Width of the source"
        className="hidden lg:block"
      />

      <main className="flex min-h-0 flex-1 flex-col">
        {/* The drawing fills this box by position, not by a percentage height: a canvas
            sized in percent does not shrink when the plots take room below it. */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-paper">
          <div className="absolute inset-0">
            <Viewport />
          </div>
          <ViewportTools />
          <TitleBlock />
          {stale && (
            <p
              role="status"
              className="absolute bottom-3 left-3 max-w-[45%] border border-red bg-sheet px-3 py-1 text-sm"
            >
              {hasDrawing
                ? "The source has errors. This is the last version that worked."
                : "Nothing to draw yet. Fix the problems listed below the source, or load an example."}
            </p>
          )}
        </div>
        <Splitter
          panel="plots"
          axis="y"
          target="next"
          min={90}
          max={(height) => height * 0.8}
          label="Height of the plots"
          className="hidden lg:block"
        />
        <Plots />
      </main>
      <Splitter
        panel="side"
        axis="x"
        target="next"
        min={220}
        max={(width) => width * 0.45}
        label="Width of the side panel"
        className="hidden lg:block"
      />

      <div className="hidden min-h-0 lg:block lg:overflow-y-auto">
        <Inspector />
        <Parameters />
        <Measures />
        <Checks />
      </div>

      <Help />
      <Skill />
    </div>
  );
}
