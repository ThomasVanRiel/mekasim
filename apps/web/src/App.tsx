import { type CSSProperties, useEffect } from "react";
import { SourceEditor } from "./editor/SourceEditor.tsx";
import { EXAMPLES } from "./examples.ts";
import { decodeModel, exampleIn } from "./io/share.ts";
import { useLayout } from "./layout.ts";
import { Build } from "./panels/Build.tsx";
import { Header } from "./panels/Header.tsx";
import { Inspector } from "./panels/Inspector.tsx";
import { Measures } from "./panels/Measures.tsx";
import { Messages } from "./panels/Messages.tsx";
import { Parameters } from "./panels/Parameters.tsx";
import { Plots } from "./panels/Plots.tsx";
import { Splitter } from "./panels/Splitter.tsx";
import { TitleBlock } from "./panels/TitleBlock.tsx";
import { TOOLS, ViewportTools } from "./panels/ViewportTools.tsx";
import { editorBridge, useStore } from "./store.ts";
import { deleteSelection, finishLink } from "./viewport/tools.ts";
import { Viewport } from "./viewport/Viewport.tsx";

/**
 * Keyboard shortcuts for the drawing, active unless a control or the editor has the
 * keys: Space plays and pauses, the arrow keys step, letters pick tools, Enter and
 * Esc finish and cancel, Delete removes the selection, Ctrl+Z undoes.
 */
function useKeys(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, .cm-editor")) return;
      const state = useStore.getState();
      const count = state.scene?.cycle.count ?? 0;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const tool = TOOLS.find((t) => t.key === key);

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        if (event.shiftKey) editorBridge.redo?.();
        else editorBridge.undo?.();
      } else if ((event.ctrlKey || event.metaKey) && key === "y") {
        editorBridge.redo?.();
      } else if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      } else if ((key === " " || key === "Enter") && target.closest("button")) {
        // Space and Enter on a focused button press that button.
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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
        if (useStore.getState().text !== example.text) useStore.getState().load(example.text);
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

export function App() {
  const hasDrawing = useStore((s) => s.scene !== undefined);
  const stale = useStore((s) => s.simulation !== s.shown);
  const source = useLayout((s) => s.source);
  const side = useLayout((s) => s.side);
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
      className="flex min-h-full flex-col lg:grid lg:h-full lg:grid-cols-[var(--source)_auto_minmax(0,1fr)_auto_var(--side)] lg:grid-rows-[auto_minmax(0,1fr)]"
    >
      <div className="lg:col-span-5">
        <Header />
      </div>

      <div className="order-last flex h-[70vh] min-h-0 flex-col border-rule lg:order-none lg:h-auto">
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <SourceEditor />
          </div>
        </div>
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

      <main className="flex h-[80vh] min-h-0 flex-col lg:h-auto">
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

      <div className="min-h-0 lg:overflow-y-auto">
        <Inspector />
        <Parameters />
        <Measures />
        <Build />
      </div>
    </div>
  );
}
