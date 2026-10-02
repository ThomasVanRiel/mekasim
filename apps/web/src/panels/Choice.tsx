/** A choice between a few named options, shown as buttons side by side. */
export function Choice<T extends string>({
  label,
  current,
  options,
  onPick,
}: {
  label: string;
  current: T;
  options: { value: T; label: string }[];
  onPick(value: T): void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-ink-soft text-sm">{label}</legend>
      <div className="flex flex-wrap">
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === current}
            onClick={() => option.value !== current && onPick(option.value)}
            className={`border px-2 py-0.5 text-sm ${i > 0 ? "-ml-px" : ""} ${
              option.value === current
                ? "border-ink bg-ink text-sheet"
                : "border-rule bg-sheet hover:border-ink-soft"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
