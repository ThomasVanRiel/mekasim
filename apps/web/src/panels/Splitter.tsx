import { useRef } from "react";
import { clamp, type Sizes, useLayout } from "../layout.ts";

/** How far an arrow key moves a divider, in pixels. */
const KEY_STEP = 24;

/**
 * A divider between two panels that can be dragged to resize the one beside it.
 * It resizes its previous or next sibling element. Arrow keys move it when it has
 * the focus; a double click puts the panel back to its default size.
 */
export function Splitter({
  panel,
  axis,
  target,
  min,
  max,
  label,
  className = "",
}: {
  panel: keyof Sizes;
  /** `x` for a divider between columns, `y` for one between rows. */
  axis: "x" | "y";
  /** Which neighbour it resizes. */
  target: "previous" | "next";
  min: number;
  /** Largest size, given the window's size in the divider's direction. */
  max(available: number): number;
  label: string;
  className?: string;
}) {
  const resize = useLayout((s) => s.resize);
  const size = useLayout((s) => s[panel]);
  const drag = useRef<{ from: number; size: number }>(undefined);
  // Dragging towards the panel shrinks it when the panel comes after the divider.
  const sign = target === "previous" ? 1 : -1;

  function available(): number {
    return axis === "x" ? window.innerWidth : window.innerHeight;
  }

  /** The panel's size as it is now, whether set or following its content. */
  function current(element: HTMLElement): number {
    const neighbour =
      target === "previous" ? element.previousElementSibling : element.nextElementSibling;
    const box = neighbour?.getBoundingClientRect();
    return (axis === "x" ? box?.width : box?.height) ?? min;
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable separator has no native element
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size === undefined ? undefined : Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max(available())}
      title={`${label}. Drag to resize, double-click to reset.`}
      className={`group relative z-30 shrink-0 touch-none select-none bg-rule ${
        axis === "x" ? "w-px cursor-col-resize" : "h-px cursor-row-resize"
      } ${className}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          from: axis === "x" ? event.clientX : event.clientY,
          size: current(event.currentTarget),
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const moved = (axis === "x" ? event.clientX : event.clientY) - drag.current.from;
        resize(panel, clamp(drag.current.size + sign * moved, min, max(available())));
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onDoubleClick={() => resize(panel, undefined)}
      onKeyDown={(event) => {
        const forward = axis === "x" ? "ArrowRight" : "ArrowDown";
        const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
        if (event.key !== forward && event.key !== back) return;
        event.preventDefault();
        event.stopPropagation();
        const step = (event.key === forward ? 1 : -1) * sign * KEY_STEP;
        resize(panel, clamp(current(event.currentTarget) + step, min, max(available())));
      }}
    >
      {/* The line is a hair wide; this wider strip around it is what the pointer takes hold of. */}
      <div
        className={`absolute group-hover:bg-dye/30 group-focus-visible:bg-dye/30 ${
          axis === "x" ? "-inset-x-1 inset-y-0" : "-inset-y-1 inset-x-0"
        }`}
      />
    </div>
  );
}
