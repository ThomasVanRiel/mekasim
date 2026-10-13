import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColors } from "../theme.ts";
import { dimensionGeometry } from "./dimension.ts";
import { gridLines, gridStep } from "./grid.ts";
import {
  type Box,
  fitted,
  panned,
  type Size,
  toScreen,
  type View,
  visible,
  worldTransform,
  zoomed,
} from "./view.ts";

interface Showing {
  view: View;
  size: Size;
}

const SheetView = createContext<Showing | undefined>(undefined);

/** Where the world lies on the sheet just now, for what is drawn on it in pixels. */
export function useSheetView(): Showing {
  const showing = useContext(SheetView);
  if (!showing) throw new Error("useSheetView is for what is drawn inside a Sheet");
  return showing;
}

/** How much one notch of the wheel zooms. */
const WHEEL = 1.0015;

/**
 * A flat drawing sheet in SVG: a grid that follows the zoom, with the world drawn on
 * it in metres, y upwards. The wheel zooms about the pointer; the middle button, or
 * Space and a drag, moves the sheet; F fits everything in view again.
 *
 * `children` are drawn in world coordinates. Lines there should carry
 * `vectorEffect="non-scaling-stroke"` to keep their width. `overlay` is drawn on top in
 * pixels, for names and dimensions, which keep their size: see `SheetLabel` and
 * `SheetDimension`.
 */
export function Sheet({
  bounds,
  unit,
  fitKey,
  label,
  children,
  overlay,
}: {
  /** What to fit in view, in metres. */
  bounds: Box;
  /** The size of a document unit in metres, which the grid is a round number of. */
  unit: number;
  /** The view is fitted anew whenever this changes, as when another model is opened. */
  fitKey?: string | number;
  /** What the drawing is, for a screen reader. */
  label: string;
  children?: ReactNode;
  overlay?: ReactNode;
}) {
  const colors = useColors();
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>();
  const [space, setSpace] = useState(false);
  const drag = useRef<{ x: number; y: number }>(undefined);
  /** Whether the sheet was moved while Space was held: that Space was not a tap. */
  const moved = useRef(false);
  const latest = useRef(bounds);
  latest.current = bounds;

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fitted once there is room to fit into, and again for another model.
  const ready = size.width > 0 && size.height > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key is what asks for a new fit
  useEffect(() => {
    if (ready) setView(fitted(latest.current, size));
  }, [ready, fitKey]);

  // The wheel must be able to keep the page from scrolling, which React's own listener cannot.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const factor = WHEEL ** (-event.deltaY * lines);
      setView(
        (now) =>
          now &&
          zoomed(
            now,
            { width: box.width, height: box.height },
            event.clientX - box.left,
            event.clientY - box.top,
            factor,
          ),
      );
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const grid = useMemo(() => {
    if (!view || !ready) return undefined;
    const step = gridStep(view.scale, unit);
    const box = visible(view, size);
    const path = { minor: "", major: "" };
    for (const line of gridLines(box.minX, box.maxX, step)) {
      const x = Math.round(toScreen(view, size, line.at, 0)[0]) + 0.5;
      path[line.major ? "major" : "minor"] += `M${x} 0V${size.height}`;
    }
    for (const line of gridLines(box.minY, box.maxY, step)) {
      const y = Math.round(toScreen(view, size, 0, line.at)[1]) + 0.5;
      path[line.major ? "major" : "minor"] += `M0 ${y}H${size.width}`;
    }
    return path;
  }, [view, size, ready, unit]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the sheet is moved with the pointer and the keys
    <div
      ref={frame}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: it takes the keys that move the view
      tabIndex={0}
      className={`absolute inset-0 touch-none select-none overflow-hidden ${
        drag.current ? "cursor-grabbing" : space ? "cursor-grab" : ""
      }`}
      style={{ background: colors.paper }}
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          setSpace(true);
        } else if ((event.key === "f" || event.key === "F") && !event.ctrlKey && !event.metaKey) {
          if (ready) setView(fitted(latest.current, size));
        }
      }}
      onKeyUp={(event) => {
        if (event.key !== " ") return;
        setSpace(false);
        // A Space that was held to move the sheet is used up; a tap goes on to the app.
        if (moved.current) event.stopPropagation();
        moved.current = false;
      }}
      onBlur={() => setSpace(false)}
      onPointerDown={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        if (event.button !== 1 && !(event.button === 0 && space)) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        drag.current = { x: event.clientX, y: event.clientY };
        if (space) moved.current = true;
        setView((now) => now && panned(now, dx, dy));
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
    >
      {view && ready && (
        <svg width={size.width} height={size.height} role="img" aria-label={label}>
          {grid && (
            <>
              <path d={grid.minor} stroke={colors.grid} fill="none" />
              <path d={grid.major} stroke={colors.gridMajor} fill="none" />
            </>
          )}
          <g transform={worldTransform(view, size)}>{children}</g>
          <SheetView.Provider value={{ view, size }}>{overlay}</SheetView.Provider>
        </svg>
      )}
    </div>
  );
}

/** A name at a place in the world, written in pixels so that it keeps its size. */
export function SheetLabel({
  x,
  y,
  dx = 6,
  dy = -6,
  strong,
  children,
}: {
  x: number;
  y: number;
  /** Offset from the place, in pixels. */
  dx?: number;
  dy?: number;
  /** A name of a part rather than of a point. */
  strong?: boolean;
  children: string;
}) {
  const { view, size } = useSheetView();
  const colors = useColors();
  const [sx, sy] = toScreen(view, size, x, y);
  return (
    <text
      x={sx + dx}
      y={sy + dy}
      fontSize={strong ? 13 : 12}
      fontWeight={strong ? 600 : 400}
      fill={strong ? colors.ink : colors.inkSoft}
      // A thin edge of paper keeps the name readable where it crosses a line.
      stroke={colors.paper}
      strokeWidth={3}
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

/** A distance between two places in the world, as a line with its value beside it. */
export function SheetDimension({
  from,
  to,
  text,
}: {
  from: [number, number];
  to: [number, number];
  text: string;
}) {
  const { view, size } = useSheetView();
  const colors = useColors();
  const a = toScreen(view, size, from[0], from[1]);
  const b = toScreen(view, size, to[0], to[1]);
  const at = dimensionGeometry(a, b);
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={colors.dye} strokeDasharray="5 3" />
      <circle cx={a[0]} cy={a[1]} r={2.5} fill={colors.dye} />
      <circle cx={b[0]} cy={b[1]} r={2.5} fill={colors.dye} />
      <text
        x={at.x}
        y={at.y}
        transform={`rotate(${at.angle} ${at.x} ${at.y})`}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
        fill={colors.dye}
        stroke={colors.paper}
        strokeWidth={3}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  );
}
