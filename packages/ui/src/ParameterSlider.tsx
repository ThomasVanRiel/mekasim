import { useState } from "react";
import { label } from "./names.ts";

/** A plain number with an optional unit, which a slider can vary. */
const LITERAL = /^(-?(?:\d+\.?\d*|\.\d+))\s*([A-Za-z/*]*)$/;

/** The least and most a parameter may be, in the unit its value is written in. */
export interface Limits {
  min?: number;
  max?: number;
}

/** The number and the unit of a value a slider can vary; nothing for an expression. */
export function sliderValue(value: unknown): { number: number; unit: string } | undefined {
  const literal = LITERAL.exec(String(value));
  return literal ? { number: Number(literal[1]), unit: literal[2] ?? "" } : undefined;
}

/**
 * How far a slider reaches: to the parameter's bounds where it has them, and
 * otherwise from nothing to twice the value, which leaves room either way.
 */
function rangeFor(value: number, limits: Limits): [number, number] {
  const [low, high] = value === 0 ? [-10, 10] : value > 0 ? [0, 2 * value] : [2 * value, 0];
  return [limits.min ?? low, limits.max ?? high];
}

/** A slider that varies a parameter written as a plain number, with its unit kept. */
export function ParameterSlider({
  name,
  value,
  unit,
  limits,
  onChange,
}: {
  name: string;
  value: number;
  unit: string;
  limits: Limits;
  /** The new value as the model writes it: a number, or a number with its unit. */
  onChange(value: number | string): void;
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
        onChange(unit ? `${next} ${unit}` : next);
      }}
    />
  );
}
