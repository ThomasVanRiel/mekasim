import type { Path } from "@mekasim/core";
import { useEffect, useId, useState } from "react";
import { useStore } from "../store.ts";

/** A number stays a number in the text; anything else is written as an expression. */
export function toValue(text: string): number | string {
  return /^-?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : text;
}

/**
 * An editable value of the model: a number or an expression. The change is written
 * when the field is left or Enter is pressed; Esc puts the old value back.
 */
export function Field({
  label,
  path,
  value,
  optional,
  hint,
}: {
  label: string;
  path: Path;
  value: number | string | undefined;
  /** Clearing an optional field removes it from the model. */
  optional?: boolean;
  hint?: string;
}) {
  const id = useId();
  const current = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  function commit(): void {
    const text = draft.trim();
    if (text === current) return;
    if (text === "") {
      if (optional) useStore.getState().apply([{ op: "delete", path }]);
      else setDraft(current);
      return;
    }
    useStore.getState().apply([{ op: "set", path, value: toValue(text) }]);
  }

  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <label htmlFor={id} className="shrink-0 text-ink-soft text-sm">
        {label}
      </label>
      <input
        id={id}
        className="w-full min-w-0 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-sm tabular-nums"
        value={draft}
        placeholder={hint}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(current);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
