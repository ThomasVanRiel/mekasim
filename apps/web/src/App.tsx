import { useEffect } from "react";
import { SourceEditor } from "./editor/SourceEditor.tsx";
import { Header } from "./panels/Header.tsx";
import { Measures } from "./panels/Measures.tsx";
import { Messages } from "./panels/Messages.tsx";
import { Timeline } from "./panels/Timeline.tsx";
import { TitleBlock } from "./panels/TitleBlock.tsx";
import { ViewportTools } from "./panels/ViewportTools.tsx";
import { useStore } from "./store.ts";
import { Viewport } from "./viewport/Viewport.tsx";

/** Space plays and pauses, the arrow keys step, unless a control or the editor has the keys. */
function usePlaybackKeys(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, button, .cm-editor")) return;
      const state = useStore.getState();
      const count = state.scene?.cycle.count ?? 0;
      if (count < 2) return;
      if (event.key === " ") {
        state.setPlaying(!state.playing);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        state.setPlaying(false);
        state.setStep((Math.floor(state.step) + direction + count) % count);
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  const hasDrawing = useStore((s) => s.scene !== undefined);
  const stale = useStore((s) => s.simulation !== s.shown);
  usePlaybackKeys();

  return (
    <div className="flex min-h-full flex-col lg:grid lg:h-full lg:grid-cols-[minmax(20rem,30%)_1fr_16rem] lg:grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="lg:col-span-3">
        <Header />
      </div>

      <div className="order-last flex h-[70vh] min-h-0 flex-col border-rule lg:order-none lg:row-span-2 lg:h-auto lg:border-r">
        <div className="min-h-0 flex-1">
          <SourceEditor />
        </div>
        <Messages />
      </div>

      <main className="relative h-[60vh] min-h-0 bg-paper lg:h-auto">
        <Viewport />
        <ViewportTools />
        <TitleBlock />
        {stale && (
          <p
            role="status"
            className="-translate-x-1/2 absolute top-3 left-1/2 w-max max-w-[80%] border border-red bg-sheet px-3 py-1 text-sm"
          >
            {hasDrawing
              ? "The source has errors. This is the last version that worked."
              : "Nothing to draw yet. Fix the problems listed below the source, or load an example."}
          </p>
        )}
      </main>

      <div className="min-h-0 border-rule lg:border-l">
        <Measures />
      </div>

      <div className="lg:col-span-2">
        <Timeline />
      </div>
    </div>
  );
}
