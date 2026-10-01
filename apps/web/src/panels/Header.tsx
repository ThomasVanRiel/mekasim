import { useRef } from "react";
import { EXAMPLES } from "../examples.ts";
import { useStore } from "../store.ts";

const button =
  "rounded-sm border border-rule bg-sheet px-2.5 py-1 text-sm hover:border-ink-soft active:bg-paper";

function fileName(name: string | undefined): string {
  const slug = (name ?? "model")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "model"}.mekasim.yaml`;
}

export function Header() {
  const name = useStore((s) => s.shown?.doc?.meta?.name);
  const load = useStore((s) => s.load);
  const input = useRef<HTMLInputElement>(null);

  function download(): void {
    const url = URL.createObjectURL(new Blob([useStore.getState().text], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(name);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-rule border-b px-4 py-2">
      <span className="font-semibold text-lg tracking-tight">mekasim</span>
      <span className="min-w-0 flex-1 truncate text-ink-soft">{name ?? "Untitled model"}</span>
      <select
        className={button}
        aria-label="Load an example"
        value=""
        onChange={(event) => {
          const example = EXAMPLES.find((e) => e.id === event.target.value);
          if (example) load(example.text);
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
      <button type="button" className={button} onClick={() => input.current?.click()}>
        Open file
      </button>
      <button type="button" className={button} onClick={download}>
        Download
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
