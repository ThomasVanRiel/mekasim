import { useStore } from "../store.ts";

const base = "border border-ink px-2.5 py-1 text-sm";
const on = "bg-ink text-sheet";
const off = "bg-sheet hover:bg-paper";

const tools = [
  {
    id: "select",
    label: "Select",
    key: "V",
    hint: "Look at the mechanism without adding contacts.",
  },
  { id: "contact", label: "Contact", key: "K", hint: "Click the two parts that may touch." },
] as const;

/** Tools that act directly on the flat drawing. */
export function Tools() {
  const tool = useStore((state) => state.tool);
  const notice = useStore((state) => state.notice);
  const setTool = useStore((state) => state.setTool);
  const hint = notice ?? tools.find(({ id }) => id === tool)?.hint;

  return (
    <div className="pointer-events-none absolute top-3 left-3 flex flex-col items-start gap-2">
      <fieldset className="pointer-events-auto flex">
        <legend className="sr-only">Drawing tools</legend>
        {tools.map((option, index) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={tool === option.id}
            aria-keyshortcuts={option.key.toLowerCase()}
            title={`${option.label} (${option.key})`}
            onClick={() => setTool(option.id)}
            className={`${base} ${index === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm"} ${tool === option.id ? on : off}`}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      {hint && <p className="max-w-sm border border-rule bg-sheet/95 px-2 py-1 text-sm">{hint}</p>}
    </div>
  );
}
