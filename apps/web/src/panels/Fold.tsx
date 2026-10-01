import { type ReactNode, useEffect } from "react";

/**
 * Marks what a folded-open panel is read beside: the source and what belongs to
 * it. A press there leaves the panel open.
 */
export const BESIDE_FOLD = "data-beside-fold";

/** A button in the bar at the top of a folded-open panel. */
export const FOLD_BUTTON =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft active:bg-paper";

/**
 * A panel folded open beside the source: it lies over the drawing and, where the
 * window leaves it no room, the panels to the right of it, which stay as they are
 * underneath, so the source can be written with the panel next to it.
 *
 * It is always there and is uncovered from the source's edge rightwards when it
 * opens, and covered again when it closes. Hidden, it takes no clicks and no focus.
 *
 * A press anywhere but on the panel and the source closes it, and still does what
 * it would have done: the panel is put away by going back to the drawing.
 */
export function Fold({
  id,
  label,
  title,
  open,
  onClose,
  actions,
  children,
}: {
  id: string;
  /** What the panel is, for a screen reader. */
  label: string;
  title: string;
  open: boolean;
  onClose(): void;
  /** Buttons beside the one that closes the panel. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onPress(event: PointerEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`#${id}, [${BESIDE_FOLD}]`)) onClose();
    }
    // Heard on the way down, so that nothing underneath can keep the press to itself.
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [open, id, onClose]);

  return (
    <section
      id={id}
      aria-label={label}
      // Placed on the grid of the page by position, so that it takes no cell from the panels under it.
      // No wider than a list of sections and a page of text: on a wide window the rest stays in view.
      className={`absolute inset-y-0 left-0 z-40 hidden w-full max-w-5xl flex-col border-rule border-r bg-sheet/95 transition-[clip-path,visibility] duration-500 ease-out motion-reduce:transition-none lg:col-start-3 lg:col-end-6 lg:row-start-2 lg:row-end-3 lg:flex ${
        open ? "visible [clip-path:inset(0)]" : "invisible [clip-path:inset(0_100%_0_0)]"
      }`}
    >
      <div className="flex items-center gap-2 border-rule border-b py-1 pr-2 pl-3">
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {actions}
        <button type="button" onClick={onClose} className={FOLD_BUTTON}>
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1">{children}</div>
    </section>
  );
}
