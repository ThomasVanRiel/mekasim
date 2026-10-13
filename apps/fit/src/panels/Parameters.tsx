import { paramValue, UNITS } from "@mekasim/core";
import { FORCE_UNITS } from "@mekasim/fit";
import { type Limits, label, ParameterSlider, sliderValue } from "@mekasim/ui";
import { useEffect, useId, useState } from "react";
import { useStore } from "../store.ts";

/** The SI value of one of a unit, mekasim's or mekafit's own; 1 for a plain number. */
function factorOf(unit: string): number {
  return (UNITS[unit] ?? FORCE_UNITS[unit])?.factor ?? 1;
}

/** A parameter's value as it is written. It is changed on Enter or on leaving; Esc puts it back. */
function Value({ name, value }: { name: string; value: string }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit(): void {
    const text = draft.trim();
    if (text === "") setDraft(value);
    else if (text !== value) {
      // A number stays a number in the text; anything else is written as an expression.
      const plain = /^-?(\d+\.?\d*|\.\d+)$/.test(text);
      useStore.getState().setParam(name, plain ? Number(text) : text);
    }
  }

  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <label htmlFor={id} className="shrink-0 text-ink-soft text-sm">
        {label(name)}
      </label>
      <input
        id={id}
        className="w-full min-w-0 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-sm tabular-nums"
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/** The named values of the model, each with a slider where it is a plain number. */
export function Parameters() {
  const params = useStore((state) => state.simulation.doc?.params);
  const bounds = useStore((state) => state.simulation.compiled?.bounds);
  const setParam = useStore((state) => state.setParam);
  const entries = Object.entries(params ?? {});

  return (
    <section aria-label="Parameters" className="border-rule border-b">
      <details open>
        <summary className="cursor-pointer border-rule border-b px-3 py-2 font-semibold">
          Parameters
        </summary>
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-ink-soft text-sm">
            The model has no parameters. A parameter is a named value under <code>params:</code>{" "}
            that other values can use.
          </p>
        ) : (
          <ul className="py-1">
            {entries.map(([name, entry]) => {
              const value = paramValue(entry);
              const literal = sliderValue(value);
              // The bounds in the unit the value is written in, to set against the slider.
              const scale = factorOf(literal?.unit ?? "");
              const compiled = bounds?.get(name);
              const limits: Limits = {
                min: compiled?.min === undefined ? undefined : compiled.min / scale,
                max: compiled?.max === undefined ? undefined : compiled.max / scale,
              };
              return (
                <li key={name} className="px-3 py-1.5">
                  <Value name={name} value={String(value)} />
                  {literal && (
                    <ParameterSlider
                      name={name}
                      value={literal.number}
                      unit={literal.unit}
                      limits={limits}
                      onChange={(next) => setParam(name, next)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}
