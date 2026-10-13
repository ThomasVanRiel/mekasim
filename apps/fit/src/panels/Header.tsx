import { asMekasim } from "@mekasim/fit";
import { download, encodeModel, fileStem, useTheme } from "@mekasim/ui";
import { useMemo, useRef, useState } from "react";
import { useStore } from "../store.ts";

const button =
  "rounded-sm border border-rule bg-sheet px-2.5 py-1 text-sm hover:border-ink-soft active:bg-paper";

/** Where mekasim is served. Its dev server stands beside this one. */
const MEKASIM =
  import.meta.env.VITE_MEKASIM_URL ?? (import.meta.env.DEV ? "http://localhost:5173/" : undefined);

export function Header() {
  const name = useStore((s) => s.shown?.doc?.meta?.name);
  const text = useStore((s) => s.text);
  const load = useStore((s) => s.load);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const input = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<"copied" | "failed">();
  // A model with nothing that mekasim lacks can be taken there as it is.
  const plain = useMemo(() => asMekasim(text), [text]);

  async function copyLink(): Promise<void> {
    try {
      const fragment = await encodeModel(useStore.getState().text);
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
      <button type="button" className={button} onClick={() => input.current?.click()}>
        Open file
      </button>
      <button
        type="button"
        className={button}
        onClick={() => download(`${fileStem(name)}.mekafit.yaml`, text, "text/yaml")}
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
        accept=".yaml,.yml,.json"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) load(await file.text());
        }}
      />
    </header>
  );
}
