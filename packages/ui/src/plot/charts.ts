import {
  cycleAxis,
  type Dim,
  docFactor,
  LENGTH,
  type PlotResult,
  pointMotion,
  type Quantity,
  type Simulation,
  type SweepRun,
  type Units,
  unitLabel,
} from "@mekasim/core";
import { label, refLabel } from "../names.ts";

/**
 * Series colours, in the fixed order they are handed out. A series keeps its slot
 * wherever it is drawn. Their values are in `index.css`, one set for each theme, each
 * checked for colour-blind separation on its sheet colour.
 */
export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

/**
 * One hue in ordered steps, for the ordered values of a sweep, from the faintest against
 * the sheet to the strongest. Checked for visible steps in each theme.
 */
export const SWEEP_COLORS = Array.from({ length: 5 }, (_, i) => `var(--sweep-${i + 1})`);

export const MAX_SWEEP_RUNS = SWEEP_COLORS.length;

export interface ChartLine {
  label: string;
  color: string;
  /** In document units, one value per sample. */
  values: Float64Array;
}

/** One chart: lines that share a unit, over the cycle. */
export interface ChartSpec {
  key: string;
  /** The plot in the model this chart belongs to. */
  plot: string;
  title: string;
  /** Unit of the vertical axis; empty for plain numbers. */
  unit: string;
  x: { label: string; unit: string; values: Float64Array };
  lines: ChartLine[];
  /** Said under the chart when something was left out. */
  note?: string;
}

/**
 * What a series is called. A measure plotted by its name reads as words, like the
 * measure itself; an expression is model text and keeps its spelling.
 */
function seriesLabel(source: string): string {
  return /^[A-Za-z_]\w*$/.test(source) ? label(source) : source;
}

/**
 * The unit a kind of quantity is shown in, where an app has one of its own for it:
 * its label, and the SI value of one of it. Nothing for a quantity it leaves to the
 * document's units.
 */
export type ShownUnit = (dim: Dim, units: Units) => { label: string; factor: number } | undefined;

/** A quantity as one value per sample in the units it is shown in; a constant becomes a level line. */
function samples(
  quantity: Quantity,
  simulation: Simulation,
  count: number,
  shown?: ShownUnit,
): Float64Array {
  const { units } = simulation.compiled as NonNullable<Simulation["compiled"]>;
  const factor = shown?.(quantity.dim, units)?.factor ?? docFactor(quantity.dim, units);
  const { value } = quantity;
  if (typeof value === "number") return new Float64Array(count).fill(value / factor);
  return value.map((v) => v / factor);
}

function axisOf(simulation: Simulation): ChartSpec["x"] | undefined {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || cycle.count < 2) return undefined;
  const axis = cycleAxis(compiled, cycle);
  return {
    label: label(axis.label),
    unit: unitLabel(axis.quantity.dim, compiled.units),
    values: samples(axis.quantity, simulation, cycle.count),
  };
}

/**
 * What to chart: the plots the model asks for, or, when it asks for none, the traced
 * points and the measures that vary, so that a moving model always shows something.
 */
export function plotsOf(simulation: Simulation): PlotResult[] {
  if (simulation.plots.length > 0) return simulation.plots;
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) return [];
  const traced = compiled.traces.map((ref): PlotResult => {
    const motion = pointMotion(compiled, cycle, ref);
    return {
      id: ref,
      series: [
        { source: `x(${ref})`, quantity: { value: motion.x, dim: LENGTH } },
        { source: `y(${ref})`, quantity: { value: motion.y, dim: LENGTH } },
      ],
    };
  });
  const varying = simulation.measures
    .filter((measure) => typeof measure.quantity?.value === "object")
    .map(
      (measure): PlotResult => ({
        id: measure.id,
        series: [{ source: measure.id, quantity: measure.quantity }],
      }),
    );
  return [...traced, ...varying];
}

/**
 * The charts of a model. A plot whose series have different units becomes one chart
 * per unit, since two scales on one chart cannot be read against each other.
 */
export function buildCharts(simulation: Simulation, shown?: ShownUnit): ChartSpec[] {
  const x = axisOf(simulation);
  const { compiled, cycle } = simulation;
  if (!x || !compiled || !cycle) return [];

  const charts: ChartSpec[] = [];
  for (const plot of plotsOf(simulation)) {
    const byUnit = new Map<string, ChartLine[]>();
    const valid = plot.series.filter((series) => series.quantity);
    valid.slice(0, SERIES_COLORS.length).forEach((series, i) => {
      const quantity = series.quantity as Quantity;
      const unit =
        shown?.(quantity.dim, compiled.units)?.label ?? unitLabel(quantity.dim, compiled.units);
      const lines = byUnit.get(unit) ?? [];
      lines.push({
        label: seriesLabel(series.source),
        color: SERIES_COLORS[i] as string,
        values: samples(quantity, simulation, cycle.count, shown),
      });
      byUnit.set(unit, lines);
    });
    const left = valid.length - SERIES_COLORS.length;
    for (const [unit, lines] of byUnit) {
      charts.push({
        key: `${plot.id}/${unit}`,
        plot: plot.id,
        title: refLabel(plot.id),
        unit,
        x,
        lines,
        note:
          left > 0
            ? `Showing the first ${SERIES_COLORS.length} of ${valid.length} series. Split the rest into another plot.`
            : undefined,
      });
    }
  }
  return charts;
}

/**
 * The charts of a sweep: one chart per series, with a line for each value of the
 * swept parameter, light to dark in the order of the values.
 */
export function buildSweepCharts(param: string, runs: SweepRun[]): ChartSpec[] {
  const solved = runs.filter((run) => axisOf(run.simulation)).slice(0, MAX_SWEEP_RUNS);
  const first = solved[0];
  if (!first) return [];
  // The run with the most samples sets the axis; a run that locks up is drawn as far as it got.
  const x = solved
    .map((run) => axisOf(run.simulation) as ChartSpec["x"])
    .reduce((a, b) => (b.values.length > a.values.length ? b : a));
  const { compiled } = first.simulation;
  if (!compiled) return [];

  const charts: ChartSpec[] = [];
  const plotsPerRun = solved.map((run) => plotsOf(run.simulation));
  for (const plot of plotsPerRun[0] ?? []) {
    plot.series.forEach((series, index) => {
      if (!series.quantity) return;
      const lines: ChartLine[] = [];
      solved.forEach((run, i) => {
        const quantity = plotsPerRun[i]?.find((p) => p.id === plot.id)?.series[index]?.quantity;
        const count = run.simulation.cycle?.count ?? 0;
        if (!quantity || count === 0) return;
        lines.push({
          label: `${label(param)} = ${run.value}`,
          color: SWEEP_COLORS[i] as string,
          values: samples(quantity, run.simulation, count),
        });
      });
      charts.push({
        key: `${plot.id}/${index}`,
        plot: plot.id,
        title:
          plot.series.length > 1
            ? `${refLabel(plot.id)}: ${seriesLabel(series.source)}`
            : refLabel(plot.id),
        unit: unitLabel(series.quantity.dim, compiled.units),
        x,
        lines,
      });
    });
  }
  return charts;
}
