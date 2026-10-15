import { useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "./geometry.ts";
import { nearestPoint, type ScatterPoint, scatterLayout } from "./scatter.ts";

const HEIGHT = 300;
const BOX = { left: 56, top: 12, bottomRoom: 40, rightRoom: 16 };
const SIZE = 3.5;

/** A mark for a run: a dot where it passed, a cross where it failed, hollow for an earlier failure. */
function Mark({
  point,
  x,
  y,
  chosen,
}: {
  point: ScatterPoint;
  x: number;
  y: number;
  chosen: boolean;
}) {
  const opacity = point.faint ? 0.18 : 1;
  const ring = chosen ? (
    <circle cx={x} cy={y} r={SIZE + 4} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />
  ) : null;
  if (point.kind === "passed") {
    return (
      <g opacity={opacity}>
        <circle cx={x} cy={y} r={SIZE} fill="var(--color-dye)" />
        {ring}
      </g>
    );
  }
  if (point.kind === "unsolved") {
    return (
      <g opacity={opacity}>
        <rect
          x={x - SIZE}
          y={y - SIZE}
          width={2 * SIZE}
          height={2 * SIZE}
          fill="none"
          stroke="var(--color-ink-soft)"
          strokeWidth={1.2}
        />
        {ring}
      </g>
    );
  }
  const d = `M${x - SIZE} ${y - SIZE}L${x + SIZE} ${y + SIZE}M${x - SIZE} ${y + SIZE}L${x + SIZE} ${y - SIZE}`;
  if (point.kind === "before") {
    // An earlier failure: an open cross, drawn as an outline of the stroke.
    return (
      <path
        d={d}
        stroke="var(--color-red)"
        strokeWidth={1}
        opacity={0.45}
        fill="none"
        strokeDasharray="2 1.5"
      />
    );
  }
  return (
    <g opacity={opacity}>
      <path d={d} stroke="var(--color-red)" strokeWidth={2} />
      {ring}
    </g>
  );
}

/**
 * The runs of a study over two of its parameters. Pointing names the run under the
 * pointer; pressing picks it.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  xRange,
  yRange,
  chosen,
  describe,
  onPick,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xRange?: [number, number];
  yRange?: [number, number];
  /** The run being shown, ringed. */
  chosen?: number;
  /** What to say about a run under the pointer. */
  describe(point: ScatterPoint): string;
  onPick(point: ScatterPoint): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<ScatterPoint>();

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(entry.contentRect.width, 240));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const box = useMemo(
    () => ({
      width,
      height: HEIGHT,
      left: BOX.left,
      right: width - BOX.rightRoom,
      top: BOX.top,
      bottom: HEIGHT - BOX.bottomRoom,
    }),
    [width],
  );
  const layout = useMemo(
    () => scatterLayout(points, box, xRange, yRange),
    [points, box, xRange, yRange],
  );
  const { x, y, toX, toY } = layout;

  // The keyboard goes from run to run in the order of their numbers.
  const runs = useMemo(
    () =>
      points
        .filter((point) => point.kind !== "before" && !point.faint)
        .sort((a, b) => a.key - b.key),
    [points],
  );
  function onKeyDown(event: { key: string; preventDefault(): void }): void {
    const now = hover ? runs.indexOf(hover) : -1;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = runs[Math.min(Math.max(now + step, 0), runs.length - 1)];
      setHover(next);
    } else if ((event.key === "Enter" || event.key === " ") && hover) {
      event.preventDefault();
      onPick(hover);
    }
  }

  function at(event: { clientX: number; clientY: number }): ScatterPoint | undefined {
    const rect = (frame.current as HTMLDivElement).getBoundingClientRect();
    return nearestPoint(points, layout, event.clientX - rect.left, event.clientY - rect.top);
  }

  // Earlier failures first, so that this run's marks lie over them.
  const order = useMemo(
    () => [...points].sort((a, b) => Number(b.kind === "before") - Number(a.kind === "before")),
    [points],
  );

  return (
    <div ref={frame} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`The runs by ${xLabel} and ${yLabel}`}
        className={hover ? "cursor-pointer" : undefined}
        onPointerMove={(event) => setHover(at(event))}
        onPointerLeave={() => setHover(undefined)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the runs are picked from here by keyboard too
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(undefined)}
        onClick={(event) => {
          const point = at(event);
          if (point) onPick(point);
        }}
      >
        <rect
          x={box.left}
          y={box.top}
          width={box.right - box.left}
          height={box.bottom - box.top}
          fill="var(--color-paper)"
        />
        {x.ticks.map((tick) => (
          <g key={`x${tick}`}>
            <line
              x1={toX(tick)}
              x2={toX(tick)}
              y1={box.top}
              y2={box.bottom}
              stroke="var(--color-rule)"
              strokeWidth={0.5}
            />
            <text
              x={toX(tick)}
              y={box.bottom + 14}
              textAnchor="middle"
              className="fill-ink-soft text-[11px] tabular-nums"
            >
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {y.ticks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={box.left}
              x2={box.right}
              y1={toY(tick)}
              y2={toY(tick)}
              stroke="var(--color-rule)"
              strokeWidth={0.5}
            />
            <text
              x={box.left - 6}
              y={toY(tick) + 4}
              textAnchor="end"
              className="fill-ink-soft text-[11px] tabular-nums"
            >
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        <text
          x={(box.left + box.right) / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          className="fill-ink text-[12px]"
        >
          {xLabel}
        </text>
        <text
          transform={`translate(12 ${(box.top + box.bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-ink text-[12px]"
        >
          {yLabel}
        </text>
        {order.map((point) => (
          <Mark
            key={`${point.kind === "before" ? "b" : ""}${point.key}`}
            point={point}
            x={toX(point.x)}
            y={toY(point.y)}
            chosen={point.kind !== "before" && point.key === chosen}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-sm border border-rule bg-sheet px-2 py-1 text-sm shadow-sm"
          style={{
            left: Math.min(toX(hover.x) + 10, width - 220),
            top: Math.max(toY(hover.y) - 34, 0),
          }}
        >
          {describe(hover)}
        </div>
      )}
    </div>
  );
}
