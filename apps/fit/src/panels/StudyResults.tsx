import { type Bin, shownValue, summarize } from "@mekasim/fit";
import { label, Scatter } from "@mekasim/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { useStudies } from "../study/store.ts";
import {
  applying,
  binRange,
  filteredSummary,
  filterText,
  keeps,
  progressText,
  rateText,
  runText,
  scatterView,
  shortRate,
  unsolvedGroups,
} from "../study/view.ts";

const select = "rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-sm";

/** Whether a bin lies within a filter's range. */
function inside(bin: Bin, range: [number, number] | undefined): boolean {
  if (!range) return false;
  const slack = 1e-9 * (Math.abs(range[1] - range[0]) + Math.abs(range[0]) + Math.abs(range[1]));
  return bin.from >= range[0] - slack && bin.to <= range[1] + slack;
}

/**
 * The pass rate in each part of a parameter's range, as a row of small bars. Dragging
 * across them, or pressing one and Shift-pressing another, keeps only the runs in that
 * part; pressing the one bin kept again lets them all back.
 */
function Strip({
  name,
  bins,
  range,
  show,
  onFilter,
}: {
  name: string;
  bins: Bin[];
  range?: [number, number];
  show(bin: Bin): string;
  onFilter(range: [number, number] | undefined): void;
}) {
  const [drag, setDrag] = useState<{ anchor: number; last: number }>();
  const anchor = useRef<number>(undefined);

  function binAt(event: { clientX: number; currentTarget: Element }): number {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / Math.max(box.width, 1);
    return Math.min(bins.length - 1, Math.max(0, Math.floor(share * bins.length)));
  }

  function pick(first: number, last: number): void {
    const chosen = binRange(bins, first, last);
    const same = range && first === last && chosen[0] === range[0] && chosen[1] === range[1];
    onFilter(same ? undefined : chosen);
  }

  const lit = (i: number): boolean =>
    drag
      ? i >= Math.min(drag.anchor, drag.last) && i <= Math.max(drag.anchor, drag.last)
      : inside(bins[i] as Bin, range);

  return (
    <fieldset
      aria-label={`${label(name)}: drag across to keep only the runs in that part`}
      className="flex h-8 cursor-col-resize touch-none items-end gap-px"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = binAt(event);
        const from = event.shiftKey && anchor.current !== undefined ? anchor.current : at;
        setDrag({ anchor: from, last: at });
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, last: binAt(event) });
      }}
      onPointerUp={() => {
        if (!drag) return;
        anchor.current = drag.anchor;
        pick(drag.anchor, drag.last);
        setDrag(undefined);
      }}
      onPointerCancel={() => setDrag(undefined)}
    >
      {bins.map((bin, i) => {
        const total = bin.passed + bin.failed;
        const share = total > 0 ? bin.passed / total : 0;
        const dim = (range !== undefined || drag !== undefined) && !lit(i);
        return (
          <button
            type="button"
            key={`${bin.from}`}
            aria-pressed={inside(bin, range)}
            className={`relative h-full flex-1 bg-paper outline-offset-1 ${
              lit(i) ? "outline outline-brass" : ""
            } ${dim ? "opacity-40" : ""}`}
            title={`${show(bin)}: ${total > 0 ? `${bin.passed} of ${total} passed` : "no runs"}`}
            // The pointer is handled by the strip; the keyboard by each bar.
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              if (event.detail !== 0) return;
              const from = event.shiftKey && anchor.current !== undefined ? anchor.current : i;
              anchor.current = from;
              pick(from, i);
            }}
          >
            {total > 0 && (
              <span
                className="absolute inset-x-0 bottom-0 bg-dye"
                style={{ height: `${share * 100}%` }}
              />
            )}
          </button>
        );
      })}
    </fieldset>
  );
}

/** What a study came to: its pass rate, the scatter of its runs, and what was not met. */
export function StudyResults() {
  const studies = useStore((state) => state.simulation.studies);
  const units = useStore((state) => state.simulation.compiled?.units);
  const replay = useStore((state) => state.replay);
  const selected = useStudies((state) => state.selected);
  const runs = useStudies((state) => (state.selected ? state.current[state.selected] : undefined));
  const before = useStudies((state) => (state.selected ? state.before[state.selected] : undefined));
  const current = useStudies(
    (state) => state.selected !== undefined && state.keys[state.selected] === runs?.key,
  );
  const notice = useStudies((state) => state.notice);
  const filters = useStudies((state) =>
    state.selected ? state.filters[state.selected] : undefined,
  );
  const { select: pick, show, setFilter, clearFilters } = useStudies.getState();
  const [axes, setAxes] = useState<{ study?: string; x?: string; y?: string }>({});
  const [only, setOnly] = useState<string>();

  const overall = useMemo(() => (runs ? summarize(runs.plan, runs.results) : undefined), [runs]);
  const kept = useMemo(() => (runs ? applying(runs.plan, filters ?? {}) : {}), [runs, filters]);
  const filtering = Object.keys(kept).length > 0;
  const keptCount = useMemo(
    () => runs?.results.filter((result) => keeps(result, kept)).length ?? 0,
    [runs, kept],
  );
  // What the runs the filters keep come to; with no filter, all of them.
  const summary = useMemo(
    () => (runs && filtering ? filteredSummary(runs.plan, runs.results, kept) : overall),
    [runs, filtering, kept, overall],
  );
  const earlier = useMemo(
    () => (before ? summarize(before.plan, before.results) : undefined),
    [before],
  );
  // The two parameters that matter most, until others are chosen.
  const names = runs?.plan.varied.map(({ name }) => name) ?? [];
  const x =
    axes.study === selected && axes.x && names.includes(axes.x)
      ? axes.x
      : (overall?.telling[0] ?? names[0]);
  const yChosen = axes.study === selected && axes.y && names.includes(axes.y) ? axes.y : undefined;
  const y =
    yChosen ?? overall?.telling.find((name) => name !== x) ?? names.find((name) => name !== x);
  const view = useMemo(
    () => (runs && units ? scatterView(runs, units, x, y, before, only, kept) : undefined),
    [runs, units, x, y, before, only, kept],
  );
  useEffect(() => {
    if (only && !summary?.failures.some(({ condition }) => condition === only)) setOnly(undefined);
  }, [only, summary]);

  if (studies.size === 0) {
    return <p className="px-3 py-3 text-ink-soft text-sm">The model has no studies.</p>;
  }
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {studies.size > 1 && (
          <label className="flex items-baseline gap-1 text-sm">
            Study
            <select
              className={select}
              value={selected}
              onChange={(event) => pick(event.target.value)}
            >
              {[...studies.keys()].map((name) => (
                <option key={name} value={name}>
                  {label(name)}
                </option>
              ))}
            </select>
          </label>
        )}
        {runs && summary ? (
          <>
            <span className="font-semibold tabular-nums">{rateText(summary)}</span>
            <span className="text-ink-soft text-sm tabular-nums">{progressText(runs)}</span>
            {earlier && <span className="text-sm tabular-nums">Before: {shortRate(earlier)}</span>}
            {filtering && overall && (
              <span className="text-sm tabular-nums">All runs: {shortRate(overall)}</span>
            )}
          </>
        ) : (
          <span className="text-ink-soft text-sm">
            Not run yet. Press Run beside the study in the side panel.
          </span>
        )}
      </div>
      {runs && !current && (
        <p className="mt-1 text-ink-soft text-sm">
          These results are from an earlier version of the model. Run the study again to look at its
          runs one by one; these stay to compare against.
        </p>
      )}
      {notice && <p className="mt-1 text-red text-sm">{notice}</p>}
      {runs && units && filtering && selected && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span>
            Only the runs with {filterText(runs.plan, kept, units)}: {keptCount} of{" "}
            {runs.results.length}.
          </span>
          <button
            type="button"
            className="rounded-sm border border-rule bg-sheet px-2 py-0.5 hover:border-ink-soft"
            onClick={() => clearFilters(selected)}
          >
            Show all runs
          </button>
        </p>
      )}

      {runs && summary && units && view && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] gap-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-3 text-sm">
              {names.length > 1 && (
                <>
                  <label className="flex items-baseline gap-1">
                    Across
                    <select
                      className={select}
                      value={x}
                      onChange={(event) => setAxes({ study: selected, x: event.target.value, y })}
                    >
                      {names.map((name) => (
                        <option key={name} value={name}>
                          {label(name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-baseline gap-1">
                    Up
                    <select
                      className={select}
                      value={y}
                      onChange={(event) => setAxes({ study: selected, x, y: event.target.value })}
                    >
                      {names.map((name) => (
                        <option key={name} value={name}>
                          {label(name)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <span className="text-ink-soft">
                <span className="text-dye">●</span> passed <span className="text-red">✕</span>{" "}
                failed
                {summary.unsolved > 0 && <> ▫ could not be solved</>}
                {before && <> · faint dashed crosses failed before</>}
              </span>
            </div>
            <Scatter
              points={view.points}
              xLabel={view.xLabel}
              yLabel={view.yLabel}
              xRange={view.xRange}
              yRange={view.yRange}
              chosen={replay && replay.study === selected ? replay.index : undefined}
              describe={(point) => {
                const result = runs.results.find(({ index }) => index === point.key);
                return result ? runText(result, runs.plan, units) : `Run ${point.key + 1}`;
              }}
              onPick={(point) => selected && show(selected, point.key)}
            />
            {current && (
              <p className="text-ink-soft text-sm">Click a run to see it on the drawing.</p>
            )}
          </div>
          <div className="text-sm">
            <h3 className="font-semibold">Not met</h3>
            {summary.failures.length === 0 ? (
              <p className="text-ink-soft">
                {summary.done > 0 ? "Every condition was met." : "No runs yet."}
              </p>
            ) : (
              <ul className="mb-2">
                {summary.failures.map(({ condition, count }) => (
                  <li key={condition}>
                    <button
                      type="button"
                      aria-pressed={only === condition}
                      onClick={() => setOnly(only === condition ? undefined : condition)}
                      className={`flex w-full justify-between gap-2 px-1 py-0.5 text-left hover:bg-paper ${
                        only === condition ? "bg-paper font-semibold" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{label(condition)}</span>
                      <span className="tabular-nums">
                        {count} {count === 1 ? "run" : "runs"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {only && (
              <p className="mb-2 text-ink-soft">Showing the runs that failed {label(only)}.</p>
            )}
            {summary.unsolved > 0 && (
              <>
                <h3 className="font-semibold">Could not be solved</h3>
                <ul className="mb-2">
                  {unsolvedGroups(runs.results.filter((result) => keeps(result, kept))).map(
                    ({ message, indices }) => (
                      <li key={message} className="py-0.5">
                        {message}{" "}
                        <span className="text-ink-soft">
                          ({indices.length === 1 ? "run" : "runs"}{" "}
                          {indices
                            .slice(0, 6)
                            .map((index) => index + 1)
                            .join(", ")}
                          {indices.length > 6 ? ", …" : ""})
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </>
            )}
            <h3 className="font-semibold">Passed over each range</h3>
            <p className="mb-1 text-ink-soft">
              Drag across a strip to keep only the runs in that part of its range.
            </p>
            {summary.parameters.map((rates) => {
              const varied = runs.plan.varied.find(({ name }) => name === rates.name);
              if (!varied) return null;
              const show = (value: number): string => shownValue(value, varied.dim, units);
              const first = rates.bins[0];
              const last = rates.bins.at(-1);
              return (
                <div key={rates.name} className="mb-2">
                  <div className="flex justify-between gap-2">
                    <span>{label(rates.name)}</span>
                    {first && last && (
                      <span className="text-ink-soft tabular-nums">
                        {show(first.from)} to {show(last.to)}
                      </span>
                    )}
                  </div>
                  <Strip
                    name={rates.name}
                    bins={rates.bins}
                    range={kept[rates.name]}
                    show={(bin) =>
                      bin.from === bin.to ? show(bin.from) : `${show(bin.from)} to ${show(bin.to)}`
                    }
                    onFilter={(range) => selected && setFilter(selected, rates.name, range)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
