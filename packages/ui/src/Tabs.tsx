import type { ReactNode } from "react";

/**
 * Tabs across the top of a panel: which of its contents is shown. A tab can carry a
 * note beside its name, such as how many of something are missing.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  current,
  onPick,
  children,
}: {
  /** What the tabs choose between, for a screen reader. */
  label: string;
  tabs: readonly { id: T; name: string; note?: string }[];
  current: T;
  onPick(id: T): void;
  /** What stands at the other end of the row, such as buttons. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center border-rule border-b">
      <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 self-stretch">
        {tabs.map(({ id, name, note }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={current === id}
            onClick={() => onPick(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 font-semibold ${
              current === id ? "border-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {name}
            {note && (
              <span className="ml-1.5 rounded-sm bg-(--amber) px-1 font-normal text-[12px] text-ink">
                {note}
              </span>
            )}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
