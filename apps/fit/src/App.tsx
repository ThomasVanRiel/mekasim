import { docFactor, LENGTH } from "@mekasim/core";
import { decodeModel, exampleIn, Sheet, Splitter, track } from "@mekasim/ui";
import { type CSSProperties, useEffect, useState } from "react";
import { gapsWithContact } from "./contacts.ts";
import { EXAMPLES } from "./examples.ts";
import { useLayout } from "./layout.ts";
import { Contacts } from "./panels/Contacts.tsx";
import { Header } from "./panels/Header.tsx";
import { Parameters } from "./panels/Parameters.tsx";
import { Replaying } from "./panels/Replaying.tsx";
import { Run } from "./panels/Run.tsx";
import { Source } from "./panels/Source.tsx";
import { SpringsLocks } from "./panels/SpringsLocks.tsx";
import { Studies } from "./panels/Studies.tsx";
import { advance, stepped } from "./playback.ts";
import { Drawing, Names } from "./sheet/Drawing.tsx";
import { Tools } from "./sheet/Tools.tsx";
import { locksAt } from "./springs.ts";
import { useStore } from "./store.ts";
import { touchesAt } from "./touches.ts";

/** Moves the position in the run on with the clock while it plays. */
function usePlayback(): void {
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    function tick(now: number): void {
      const seconds = (now - last) / 1000;
      last = now;
      const { playing, scene, step, rate, setStep } = useStore.getState();
      if (playing && scene && scene.cycle.count > 1) {
        const { cycle, periodic } = scene;
        const dt = (cycle.t[1] as number) - (cycle.t[0] as number);
        setStep(advance(step, seconds, rate, { count: cycle.count, dt, periodic }));
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
}

/** Space plays and pauses; the arrows step. Not while something is being typed. */
function useKeys(): void {
  useEffect(() => {
    function typing(event: KeyboardEvent): boolean {
      return (
        event.target instanceof Element && event.target.closest("input, textarea, select") !== null
      );
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useStore.getState();
      const count = state.scene?.cycle.count ?? 0;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        state.setPlaying(false);
        state.setStep(stepped(state.step, event.key === "ArrowRight" ? 1 : -1, count));
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        state.setTool("contact");
      } else if (event.key.toLowerCase() === "v" || event.key === "Escape") {
        event.preventDefault();
        state.setTool("select");
      }
    }
    // On the way up, so that the sheet can take a Space that was held to move it.
    function onKeyUp(event: KeyboardEvent): void {
      if (event.key !== " " || typing(event) || event.target instanceof HTMLButtonElement) return;
      const state = useStore.getState();
      state.setPlaying(!state.playing);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}

/** How long a solve goes on before the sheet says it is under way: quick ones pass unremarked. */
const SOLVING_NOTE_MS = 300;

/** Whether `on` has been true for at least `ms`. */
function useLate(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

/** A model that arrives packed into the link replaces the one kept from the last visit. */
function useLinkedModel(): void {
  const text = useStore((s) => s.text);

  useEffect(() => {
    function open(): void {
      const example = EXAMPLES.find(({ id }) => id === exampleIn(location.hash));
      if (example) {
        if (useStore.getState().text !== example.text) {
          useStore.getState().load(example.text, example.files);
          track("Open link", { model: "example", example: example.id });
        }
        return;
      }
      decodeModel(location.hash).then((packed) => {
        if (packed === undefined) return;
        useStore.getState().load(packed);
        track("Open link", { model: "own" });
        history.replaceState(null, "", location.pathname + location.search);
      });
    }
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  useEffect(() => {
    const example = EXAMPLES.find(({ id }) => id === exampleIn(location.hash));
    if (example && example.text !== text) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [text]);
}

export function App() {
  const scene = useStore((s) => s.scene);
  const shown = useStore((s) => s.shown);
  const units = useStore((s) => s.shown?.compiled?.units);
  const name = useStore((s) => s.shown?.doc?.meta?.name);
  const step = useStore((s) => s.step);
  const gaps = useStore((s) => s.shown?.gaps);
  const contact = useStore((s) => s.contact);
  const tool = useStore((s) => s.tool);
  const contactDraft = useStore((s) => s.contactDraft);
  const opened = useStore((s) => s.opened);
  const stale = useStore((s) => s.simulation !== s.shown && !s.replay);
  const solving = useLate(
    useStore((s) => s.solving),
    SOLVING_NOTE_MS,
  );
  const source = useLayout((s) => s.source);
  const side = useLayout((s) => s.side);
  const resize = useLayout((s) => s.resize);
  usePlayback();
  useKeys();
  useLinkedModel();

  return (
    <div
      // The source's width, as set by dragging the divider, or else the default.
      style={
        {
          "--source": source === undefined ? "minmax(20rem, 28%)" : `${source}px`,
          "--side": side === undefined ? "19rem" : `${side}px`,
        } as CSSProperties
      }
      className="grid h-full grid-cols-[var(--source)_auto_minmax(0,1fr)_auto_var(--side)] grid-rows-[auto_minmax(0,1fr)]"
    >
      <div className="col-span-5">
        <Header />
      </div>
      <Source />
      <Splitter
        size={source}
        onResize={(size) => resize("source", size)}
        axis="x"
        target="previous"
        min={220}
        max={(width) => width * 0.6}
        label="Width of the source"
      />
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden bg-paper">
          {scene && units ? (
            <Sheet
              bounds={scene.bounds}
              unit={docFactor(LENGTH, units)}
              fitKey={opened}
              label={`Drawing of ${name ?? "the model"}`}
              overlay={
                <Names
                  scene={scene}
                  step={step}
                  gaps={gapsWithContact(gaps ?? [], contact)}
                  units={units}
                />
              }
            >
              <Drawing
                scene={scene}
                step={step}
                tool={tool}
                contactDraft={contactDraft}
                locks={locksAt(shown, step)}
                touches={touchesAt(shown, step)}
                onBody={(body) => useStore.getState().pickContact(body)}
              />
            </Sheet>
          ) : null}
          <Tools />
          <Replaying />
          {solving ? (
            <p
              role="status"
              className="absolute bottom-3 left-3 max-w-[45%] border border-rule bg-sheet px-3 py-1 text-ink-soft text-sm"
            >
              Working out the motion…
            </p>
          ) : (
            stale && (
              <p
                role="status"
                className="absolute bottom-3 left-3 max-w-[45%] border border-red bg-sheet px-3 py-1 text-sm"
              >
                {scene
                  ? "The source has errors. This is the last version that worked."
                  : "Nothing to draw yet. Fix the problems listed below the source."}
              </p>
            )
          )}
        </div>
        <Run />
      </main>
      <Splitter
        size={side}
        onResize={(size) => resize("side", size)}
        axis="x"
        target="next"
        min={220}
        max={(width) => width * 0.45}
        label="Width of the side panel"
      />
      <aside className="min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-sheet">
        <Parameters />
        <Contacts />
        <SpringsLocks />
        <Studies />
      </aside>
    </div>
  );
}
