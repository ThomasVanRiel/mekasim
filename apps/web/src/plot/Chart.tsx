import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartSpec } from "./charts.ts";
import {
  extentScale,
  formatNumber,
  linePath,
  mapper,
  nearestIndex,
  PLOT_LEFT,
  PLOT_PAD,
  PLOT_RIGHT,
  spread,
  valueScale,
} from "./geometry.ts";

const HEIGHT = 170;
const TOP = 10;
const BOTTOM = 34;
const LEFT = PLOT_LEFT;
/** Up to this many lines get their name written at their end as well as in the legend. */
const DIRECT_LABELS = 4;

function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value;
}

/** A short stroke in a line's colour: the key that ties a name to its line. */
function Key({ color }: { color: string }) {
  return (
    <span className="inline-block h-0.5 w-4 shrink-0 align-middle" style={{ background: color }} />
  );
}

/**
 * A line chart of one or more series over the cycle. The marker follows the
 * playback; pointing shows the values at that position, and pressing moves the
 * playback there.
 */
export function Chart({
  spec,
  step,
  onScrub,
}: {
  spec: ChartSpec;
  /** Current position in the cycle, as a sample index. */
  step: number;
  onScrub(index: number): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ index: number; left: number }>();
  const pressed = useRef(false);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(entry.contentRect.width, 240));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { x, lines, unit } = spec;
  // The lines themselves change only with the data or the width, not with every frame of playback.
  const layout = useMemo(() => {
    const direct = spec.lines.length > 1 && spec.lines.length <= DIRECT_LABELS;
    const right = width - PLOT_RIGHT;
    const bottom = HEIGHT - BOTTOM;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const line of spec.lines) {
      for (const value of line.values) {
        if (!Number.isFinite(value)) continue;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    if (!Number.isFinite(low)) return undefined;

    const xs = spec.x.values;
    const xScale = extentScale(
      xs[0] as number,
      xs.at(-1) as number,
      width / 90,
      spec.x.unit === "deg",
    );
    const yScale = valueScale(low, high);
    const mapX = mapper(xScale, LEFT, right);
    const mapY = mapper(yScale, bottom, TOP);
    return {
      direct,
      right,
      bottom,
      xScale,
      yScale,
      mapX,
      mapY,
      paths: spec.lines.map((line) => linePath(xs, line.values, mapX, mapY)),
      ends: spread(
        spec.lines.map((line) => mapY(line.values.at(-1) as number)),
        13,
        TOP + 4,
        bottom - 2,
      ),
    };
  }, [spec, width]);
  if (!layout) return null;
  const { direct, right, bottom, xScale, yScale, mapX, mapY, paths, ends } = layout;
  const at = Math.min(Math.max(Math.floor(step), 0), x.values.length - 1);
  const shown = hover?.index ?? at;

  function indexAt(clientX: number): number {
    const box = (frame.current as HTMLDivElement).getBoundingClientRect();
    const value =
      xScale.min + ((clientX - box.left - LEFT) / (right - LEFT)) * (xScale.max - xScale.min);
    return nearestIndex(x.values, value);
  }

  return (
    <figure className="py-2" style={{ paddingInline: PLOT_PAD }}>
      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 pl-1 text-sm">
        <span className="font-semibold">{spec.title}</span>
        {unit && <span className="text-ink-soft">{unit}</span>}
        {lines.length > 1 &&
          lines.map((line) => (
            <span key={line.label} className="flex items-baseline gap-1.5">
              <Key color={line.color} />
              <span className="text-ink-soft">{line.label}</span>
              <span className="tabular-nums">
                {formatNumber(line.values[Math.min(shown, line.values.length - 1)] as number)}
              </span>
            </span>
          ))}
        {lines.length === 1 && (
          <span className="tabular-nums">
            {withUnit(
              formatNumber(
                lines[0]?.values[Math.min(shown, (lines[0]?.values.length ?? 1) - 1)] as number,
              ),
              unit,
            )}
          </span>
        )}
      </figcaption>

      <div
        ref={frame}
        className="relative touch-none select-none"
        onPointerMove={(event) => {
          const index = indexAt(event.clientX);
          setHover({ index, left: mapX(x.values[index] as number) });
          if (pressed.current) onScrub(index);
        }}
        onPointerLeave={() => setHover(undefined)}
        onPointerDown={(event) => {
          pressed.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onScrub(indexAt(event.clientX));
        }}
        onPointerUp={() => {
          pressed.current = false;
        }}
      >
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${spec.title}${unit ? ` in ${unit}` : ""} against ${x.label}: ${lines.map((l) => l.label).join(", ")}`}
          className="block"
        >
          {yScale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={right}
                y1={mapY(tick)}
                y2={mapY(tick)}
                stroke={tick === 0 ? "var(--color-ink-soft)" : "var(--color-rule)"}
                strokeWidth={1}
              />
              <text
                x={LEFT - 8}
                y={mapY(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-soft text-[12px] tabular-nums"
              >
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {xScale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={mapX(tick)}
                x2={mapX(tick)}
                y1={bottom}
                y2={bottom + 4}
                stroke="var(--color-ink-soft)"
              />
              <text
                x={mapX(tick)}
                y={bottom + 17}
                textAnchor="middle"
                className="fill-ink-soft text-[12px] tabular-nums"
              >
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          <line x1={LEFT} x2={right} y1={bottom} y2={bottom} stroke="var(--color-ink-soft)" />
          <text x={right} y={HEIGHT - 3} textAnchor="end" className="fill-ink-soft text-[12px]">
            {withUnit(x.label, x.unit && `(${x.unit})`)}
          </text>

          {lines.map((line, i) => (
            <path
              key={line.label}
              d={paths[i]}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {direct &&
            lines.map((line, i) => (
              <text
                key={line.label}
                x={right + 8}
                y={ends[i]}
                dy="0.32em"
                className="fill-ink-soft text-[12px]"
              >
                {line.label.length > 20 ? `${line.label.slice(0, 19)}…` : line.label}
              </text>
            ))}

          {/* Where the playback is. */}
          <line
            x1={mapX(x.values[at] as number)}
            x2={mapX(x.values[at] as number)}
            y1={TOP}
            y2={bottom}
            stroke="var(--color-ink)"
            strokeWidth={1}
          />
          {lines.map((line) =>
            at < line.values.length ? (
              <circle
                key={line.label}
                cx={mapX(x.values[at] as number)}
                cy={mapY(line.values[at] as number)}
                r={4}
                fill={line.color}
                stroke="var(--color-sheet)"
                strokeWidth={2}
              />
            ) : null,
          )}
          {hover && (
            <line
              x1={hover.left}
              x2={hover.left}
              y1={TOP}
              y2={bottom}
              stroke="var(--color-ink-soft)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 border border-rule bg-sheet px-2 py-1 text-sm shadow-sm"
            style={
              hover.left > width / 2
                ? { right: width - hover.left + 10 }
                : { left: hover.left + 10 }
            }
          >
            <div className="text-ink-soft tabular-nums">
              {x.label} {withUnit(formatNumber(x.values[hover.index] as number, 4), x.unit)}
            </div>
            {lines.map((line) =>
              hover.index < line.values.length ? (
                <div key={line.label} className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <Key color={line.color} />
                  <span className="font-semibold tabular-nums">
                    {withUnit(formatNumber(line.values[hover.index] as number), unit)}
                  </span>
                  <span className="text-ink-soft">{line.label}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
      {spec.note && <p className="pl-1 text-ink-soft text-sm">{spec.note}</p>}
    </figure>
  );
}
