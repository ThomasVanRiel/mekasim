import { asMekasim, keepOutlines } from "@mekasim/fit";
import { download, encodeModel, exampleFragment, fileStem, sortFiles, useTheme } from "@mekasim/ui";
import { useMemo, useRef, useState } from "react";
import { EXAMPLES } from "../examples.ts";
import { useStore } from "../store.ts";

const button =
  "rounded-sm border border-rule bg-sheet px-2.5 py-1 text-sm hover:border-ink-soft active:bg-paper";

/** Where mekasim is served. Its dev server stands beside this one. */
const MEKASIM =
  import.meta.env.VITE_MEKASIM_URL ?? (import.meta.env.DEV ? "http://localhost:5173/" : undefined);

export function Header() {
  const name = useStore((s) => s.shown?.doc?.meta?.name);
  const text = useStore((s) => s.text);
  const files = useStore((s) => s.files);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const input = useRef<HTMLInputElement>(null);
  const drawingInput = useRef<HTMLInputElement>(null);
  const missing = useStore((s) => s.simulation.missing);
  /** Whether a body goes without its shape for want of a drawing. */
  const wanting = useStore((s) => s.simulation.unshaped.length > 0);
  const [shared, setShared] = useState<"copied" | "failed">();
  // Complete without its drawings: each outline from one kept in the text. A model that
  // has nothing mekasim lacks can be taken there.
  const whole = useMemo(() => keepOutlines(text, files), [text, files]);
  const plain = useMemo(() => asMekasim(whole), [whole]);

  async function copyLink(): Promise<void> {
    try {
      // A link carries no files, so the outlines from them are kept in the text it carries.
      const example = EXAMPLES.find((item) => item.text === text);
      const fragment = example ? exampleFragment(example.id) : await encodeModel(whole);
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${fragment}`);
      setShared("copied");
    } catch {
      setShared("failed");
    }
    setTimeout(() => setShared(undefined), 2500);
  }

  async function openInMekasim(): Promise<void> {
    if (!plain || !MEKASIM) return;
    window.open(`${MEKASIM}${await encodeModel(plain)}`, "_blank", "noopener");
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-rule border-b px-4 py-2">
      <span className="font-semibold text-lg tracking-tight">mekafit</span>
      <span className="min-w-0 flex-1 truncate text-ink-soft">{name ?? "Untitled model"}</span>
      <select
        className={button}
        aria-label="Load an example"
        value=""
        onChange={(event) => {
          const example = EXAMPLES.find(({ id }) => id === event.target.value);
          if (!example) return;
          useStore.getState().load(example.text, example.files);
          history.replaceState(null, "", exampleFragment(example.id));
        }}
      >
        <option value="" disabled>
          Load an example
        </option>
        {EXAMPLES.map((example) => (
          <option key={example.id} value={example.id}>
            {example.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={button}
        title="A model. The drawings it names can be picked along with it, or added afterwards"
        onClick={() => input.current?.click()}
      >
        Open model
      </button>
      <button
        type="button"
        // Stands out while the model names a drawing that is not here.
        className={wanting ? `${button} border-brass` : button}
        title={
          wanting
            ? `This model takes shapes from ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not attached yet`
            : "Attach a DXF drawing to this model, or a newer one in place of one it has"
        }
        onClick={() => drawingInput.current?.click()}
      >
        Add drawing
      </button>
      <input
        ref={drawingInput}
        type="file"
        accept=".dxf"
        multiple
        className="hidden"
        onChange={async (event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = "";
          const read = await Promise.all(
            picked.map(async (file) => [file.name, await file.text()] as const),
          );
          useStore.getState().attach(new Map(read));
        }}
      />
      <button
        type="button"
        className={button}
        onClick={() => download(`${fileStem(name)}.mekafit.yaml`, whole, "text/yaml")}
      >
        Download
      </button>
      <button type="button" className={button} onClick={copyLink}>
        {shared === "copied" ? "Link copied" : shared === "failed" ? "Could not copy" : "Copy link"}
      </button>
      {plain && MEKASIM && (
        <button
          type="button"
          className={button}
          title="This model has nothing that mekasim lacks, so it opens there as it is"
          onClick={openInMekasim}
        >
          Open in mekasim
        </button>
      )}
      <button type="button" className={button} onClick={toggleTheme}>
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </button>
      <input
        ref={input}
        type="file"
        accept=".yaml,.yml,.json,.dxf"
        multiple
        className="hidden"
        onChange={async (event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = "";
          const read = await Promise.all(
            picked.map(async (file) => [file.name, await file.text()] as const),
          );
          const { model, drawings } = sortFiles(read);
          const state = useStore.getState();
          // A model opens with the drawings picked along with it; drawings alone join this model.
          if (model !== undefined) state.load(model, drawings);
          else if (drawings.size > 0) state.attach(drawings);
        }}
      />
    </header>
  );
}
