import { useState } from "react";
import { LIVE, useStore } from "../store.ts";
import { Field, toValue } from "./Field.tsx";

/** A plain number with an optional unit, which a slider can vary. */
const LITERAL = /^(-?(?:\d+\.?\d*|\.\d+))\s*([A-Za-z/]*)$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** From nothing to twice the value: room to explore either way. */
function rangeFor(value: number): [number, number] {
  if (value === 0) return [-10, 10];
  return value > 0 ? [0, 2 * value] : [2 * value, 0];
}

function Slider({ name, value, unit }: { name: string; value: number; unit: string }) {
  // The range is fixed while the slider is held, so that it does not grow under the pointer.
  const [held, setHeld] = useState<[number, number]>();
  const [low, high] = held ?? rangeFor(value);
  const step = 10 ** Math.floor(Math.log10((high - low) / 200));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));

  return (
    <input
      type="range"
      aria-label={`Vary ${name}`}
      className="w-full"
      min={low}
      max={high}
      step={step}
      value={value}
      onPointerDown={() => setHeld(rangeFor(value))}
      onPointerUp={() => setHeld(undefined)}
      onBlur={() => setHeld(undefined)}
      onChange={(event) => {
        const next = Number(Number(event.target.value).toFixed(decimals));
        useStore
          .getState()
          .apply(
            [{ op: "set", path: ["params", name], value: unit ? `${next} ${unit}` : next }],
            LIVE,
          );
      }}
    />
  );
}

function AddParameter({ taken }: { taken: string[] }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const valid = NAME.test(name) && !taken.includes(name) && value.trim() !== "";
  const input = "min-w-0 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-sm";

  return (
    <form
      className="flex items-center gap-1.5 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const done = useStore
          .getState()
          .apply([{ op: "set", path: ["params", name], value: toValue(value.trim()) }]);
        if (done) {
          setName("");
          setValue("");
        }
      }}
    >
      <input
        aria-label="Name of a new parameter"
        className={`${input} w-20`}
        placeholder="name"
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label="Value of the new parameter"
        className={`${input} flex-1`}
        placeholder="40 mm"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="submit"
        disabled={!valid}
        className="rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm enabled:hover:border-ink-soft disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}

/** Named values of the model, each with a slider where it is a plain number. */
export function Parameters() {
  const params = useStore((s) => s.simulation.doc?.params);
  const hasDoc = useStore((s) => s.simulation.doc !== undefined);
  const apply = useStore((s) => s.apply);
  const entries = Object.entries(params ?? {});

  return (
    <section aria-label="Parameters" className="border-rule border-b">
      <h2 className="border-rule border-b px-3 py-2 font-semibold">Parameters</h2>
      {entries.length === 0 && (
        <p className="px-3 pt-2 text-ink-soft text-sm">
          A parameter is a named value, such as a length, that points and other values can use.
          Slide it to see what it does.
        </p>
      )}
      {entries.map(([name, value]) => {
        const literal = LITERAL.exec(String(value));
        return (
          <div key={name} className="border-rule border-b px-3 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <Field label={name} path={["params", name]} value={value} />
              <button
                type="button"
                aria-label={`Remove parameter ${name}`}
                className="shrink-0 px-1 text-ink-soft hover:text-red"
                onClick={() => apply([{ op: "delete", path: ["params", name] }])}
              >
                ×
              </button>
            </div>
            {literal && <Slider name={name} value={Number(literal[1])} unit={literal[2] ?? ""} />}
          </div>
        );
      })}
      {hasDoc && <AddParameter taken={entries.map(([name]) => name)} />}
    </section>
  );
}
