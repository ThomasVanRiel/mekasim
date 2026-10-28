import { keepOutlines, NEW_MODEL } from "@mekasim/core";
import {
  download,
  encodeModel,
  exampleFragment,
  fileStem,
  sortFiles,
  track,
  useTheme,
} from "@mekasim/ui";
import { useRef, useState } from "react";
import { EXAMPLES } from "../examples.ts";
import { useStore } from "../store.ts";
import { Make } from "./Build.tsx";

const button =
  "rounded-sm border border-rule bg-sheet px-2.5 py-1 text-sm hover:border-ink-soft active:bg-paper";

/** Buttons for working on a model, which a small screen has no room to do. */
const editing = `${button} hidden lg:inline-block`;

export function Header() {
  const name = useStore((s) => s.shown?.doc?.meta?.name);
  const load = useStore((s) => s.load);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const input = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<"copied" | "failed">();

  async function copyLink(): Promise<void> {
    try {
      // An untouched example has a short link by its name; anything else is packed into the link.
      const { text } = useStore.getState();
      const example = EXAMPLES.find((e) => e.text === text);
      // A link carries no files, so the outlines from them are kept in the text it carries.
      const whole = keepOutlines(text, useStore.getState().files);
      const fragment = example ? exampleFragment(example.id) : await encodeModel(whole);
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${fragment}`);
      setShared("copied");
      track("Copy link", { model: example ? "example" : "own" });
    } catch {
      setShared("failed");
    }
    setTimeout(() => setShared(undefined), 2500);
  }

  function save(): void {
    // Saved with the outlines of its drawings kept in it, so the one file is the whole model.
    const { text, files } = useStore.getState();
    download(`${fileStem(name)}.mekasim.yaml`, keepOutlines(text, files), "text/yaml");
    track("Download model");
  }

  return (
    <header className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-rule border-b px-4 py-2">
      <span className="font-semibold text-lg tracking-tight">mekasim</span>
      <span className="min-w-0 flex-1 truncate text-ink-soft">{name ?? "Untitled model"}</span>
      <button
        type="button"
        className={editing}
        onClick={() => {
          load(NEW_MODEL);
          track("New model");
        }}
      >
        New model
      </button>
      <select
        className={button}
        aria-label="Load an example"
        value=""
        onChange={(event) => {
          const example = EXAMPLES.find((e) => e.id === event.target.value);
          if (!example) return;
          load(example.text, example.files);
          // Show the example's own link in the address bar.
          history.replaceState(null, "", exampleFragment(example.id));
          track("Load example", { example: example.id });
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
      <button type="button" className={editing} onClick={() => input.current?.click()}>
        Open file
      </button>
      <button type="button" className={editing} onClick={save}>
        Download
      </button>
      <button type="button" className={editing} onClick={copyLink}>
        {shared === "copied" ? "Link copied" : shared === "failed" ? "Could not copy" : "Copy link"}
      </button>
      <Make className={button} />
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
          // A model opens with the drawings picked along with it; drawings alone join this model.
          const { model, drawings } = sortFiles(read);
          if (model !== undefined) load(model, drawings);
          else if (drawings.size > 0) useStore.getState().attach(drawings);
          if (model !== undefined || drawings.size > 0) {
            track("Open file", { model: model !== undefined, drawings: drawings.size });
          }
        }}
      />
    </header>
  );
}
