import { type Path, paramValue, UNITS } from "@mekasim/core";
import { useState } from "react";
import { label } from "../names.ts";
import { MAX_SWEEP_RUNS } from "../plot/charts.ts";
import { LIVE, type Sweep, useStore } from "../store.ts";
import { Field, toValue } from "./Field.tsx";

/** A plain number with an optional unit, which a slider can vary. */
const LITERAL = /^(-?(?:\d+\.?\d*|\.\d+))\s*([A-Za-z/]*)$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The least and most a parameter may be, in the unit its value is written in. */
interface Limits {
  min?: number;
  max?: number;
}

/**
 * How far a slider reaches: to the parameter's bounds where it has them, and
 * otherwise from nothing to twice the value, which leaves room either way.
 */
function rangeFor(value: number, limits: Limits): [number, number] {
  const [low, high] = value === 0 ? [-10, 10] : value > 0 ? [0, 2 * value] : [2 * value, 0];
  return [limits.min ?? low, limits.max ?? high];
}

function Slider({
  name,
  path,
  value,
  unit,
  limits,
}: {
  name: string;
  /** Where the value is written in the model. */
  path: Path;
  value: number;
  unit: string;
  limits: Limits;
}) {
  // The range is fixed while the slider is held, so that it does not grow under the pointer.
  const [held, setHeld] = useState<[number, number]>();
  const [low, high] = held ?? rangeFor(value, limits);
  const step = 10 ** Math.floor(Math.log10((high - low) / 200));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));

  return (
    <input
      type="range"
      aria-label={`Vary ${label(name)}`}
      className="w-full"
      min={low}
      max={high}
      step={step}
      value={value}
      onPointerDown={() => setHeld(rangeFor(value, limits))}
      onPointerUp={() => setHeld(undefined)}
      onBlur={() => setHeld(undefined)}
      onChange={(event) => {
        const next = Number(Number(event.target.value).toFixed(decimals));
        useStore
          .getState()
          .apply([{ op: "set", path, value: unit ? `${next} ${unit}` : next }], LIVE);
      }}
    />
  );
}

function NumberBox({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-baseline gap-1 text-ink-soft text-sm">
      {label}
      <input
        type="number"
        className="w-full min-w-0 rounded-sm border border-rule bg-sheet px-1 py-0.5 text-ink tabular-nums"
        value={value}
        min={min}
        max={max}
        step="any"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

/** Compare the model at several values of a parameter. */
function SweepControls({
  name,
  value,
  unit,
  limits,
}: {
  name: string;
  value: number;
  unit: string;
  limits: Limits;
}) {
  const sweep = useStore((s) => (s.sweep?.param === name ? s.sweep : undefined));
  const setSweep = useStore((s) => s.setSweep);
  const change = (part: Partial<Sweep>): void => {
    if (sweep) setSweep({ ...sweep, ...part });
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={sweep !== undefined}
        className={`self-start rounded-sm border px-1.5 text-[12px] ${
          sweep ? "border-ink bg-ink text-sheet" : "border-rule bg-sheet hover:border-ink-soft"
        }`}
        onClick={() =>
          setSweep(
            sweep
              ? undefined
              : {
                  param: name,
                  // Across the whole allowed range where there is one.
                  from: limits.min ?? Number((value * 0.5).toPrecision(4)),
                  to: limits.max ?? Number((value * 1.5).toPrecision(4)),
                  count: 5,
                  unit,
                },
          )
        }
      >
        {sweep ? "Stop comparing" : "Compare values"}
      </button>
      {sweep && (
        <div className="flex gap-1.5">
          <NumberBox label="from" value={sweep.from} onChange={(from) => change({ from })} />
          <NumberBox label="to" value={sweep.to} onChange={(to) => change({ to })} />
          <NumberBox
            label="in"
            value={sweep.count}
            min={2}
            max={MAX_SWEEP_RUNS}
            onChange={(count) =>
              change({ count: Math.min(Math.max(Math.round(count), 2), MAX_SWEEP_RUNS) })
            }
          />
        </div>
      )}
    </div>
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
  const bounds = useStore((s) => s.simulation.compiled?.bounds);
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
      {entries.map(([name, entry]) => {
        const value = paramValue(entry);
        const bounded = typeof entry === "object";
        const path = bounded ? ["params", name, "value"] : ["params", name];
        const literal = LITERAL.exec(String(value));
        const unit = literal?.[2] ?? "";
        // The bounds in the unit the value is written in, to set against the slider.
        const scale = unit in UNITS ? (UNITS[unit] as { factor: number }).factor : 1;
        const compiledLimits = bounds?.get(name);
        const limits: Limits = {
          min: compiledLimits?.min === undefined ? undefined : compiledLimits.min / scale,
          max: compiledLimits?.max === undefined ? undefined : compiledLimits.max / scale,
        };
        /** Write a bound, turning a plain value into one with bounds when it gets its first. */
        const setBound = (side: "min" | "max") => (bound: number | string | undefined) => {
          if (bounded) {
            const at = ["params", name, side];
            apply([
              bound === undefined
                ? { op: "delete", path: at }
                : { op: "set", path: at, value: bound },
            ]);
          } else if (bound !== undefined) {
            apply([{ op: "set", path: ["params", name], value: { value, [side]: bound } }]);
          }
        };
        return (
          <div key={name} className="border-rule border-b px-3 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <Field label={label(name)} path={path} value={value} />
              <button
                type="button"
                aria-label={`Remove parameter ${label(name)}`}
                className="shrink-0 px-1 text-ink-soft hover:text-red"
                onClick={() => apply([{ op: "delete", path: ["params", name] }])}
              >
                ×
              </button>
            </div>
            {literal && (
              <Slider
                name={name}
                path={path}
                value={Number(literal[1])}
                unit={unit}
                limits={limits}
              />
            )}
            <div className="flex items-baseline gap-2">
              <Field
                label="from"
                path={["params", name, "min"]}
                value={bounded ? entry.min : undefined}
                optional
                hint="no limit"
                onCommit={setBound("min")}
              />
              <Field
                label="to"
                path={["params", name, "max"]}
                value={bounded ? entry.max : undefined}
                optional
                hint="no limit"
                onCommit={setBound("max")}
              />
            </div>
            {literal && (
              <SweepControls name={name} value={Number(literal[1])} unit={unit} limits={limits} />
            )}
          </div>
        );
      })}
      {hasDoc && <AddParameter taken={entries.map(([name]) => name)} />}
    </section>
  );
}
