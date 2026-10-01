import {
  cycleAxis,
  docFactor,
  LENGTH,
  type PlotResult,
  pointMotion,
  type Quantity,
  type Simulation,
  type SweepRun,
  unitLabel,
} from "@mekasim/core";

/**
 * Series colours, in the fixed order they are handed out. A series keeps its slot
 * wherever it is drawn. Checked for colour-blind separation on the sheet colour.
 */
export const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

/** One hue from light to dark, for the ordered values of a sweep. Checked for visible steps. */
export const SWEEP_COLORS = ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

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

/** A quantity as one value per sample in document units; a constant becomes a level line. */
function samples(quantity: Quantity, simulation: Simulation, count: number): Float64Array {
  const factor = docFactor(
    quantity.dim,
    (simulation.compiled as NonNullable<Simulation["compiled"]>).units,
  );
  const { value } = quantity;
  if (typeof value === "number") return new Float64Array(count).fill(value / factor);
  return value.map((v) => v / factor);
}

function axisOf(simulation: Simulation): ChartSpec["x"] | undefined {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || cycle.count < 2) return undefined;
  const axis = cycleAxis(compiled, cycle);
  return {
    label: axis.label,
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
export function buildCharts(simulation: Simulation): ChartSpec[] {
  const x = axisOf(simulation);
  const { compiled, cycle } = simulation;
  if (!x || !compiled || !cycle) return [];

  const charts: ChartSpec[] = [];
  for (const plot of plotsOf(simulation)) {
    const byUnit = new Map<string, ChartLine[]>();
    const valid = plot.series.filter((series) => series.quantity);
    valid.slice(0, SERIES_COLORS.length).forEach((series, i) => {
      const quantity = series.quantity as Quantity;
      const unit = unitLabel(quantity.dim, compiled.units);
      const lines = byUnit.get(unit) ?? [];
      lines.push({
        label: series.source,
        color: SERIES_COLORS[i] as string,
        values: samples(quantity, simulation, cycle.count),
      });
      byUnit.set(unit, lines);
    });
    const left = valid.length - SERIES_COLORS.length;
    for (const [unit, lines] of byUnit) {
      charts.push({
        key: `${plot.id}/${unit}`,
        plot: plot.id,
        title: plot.id,
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
          label: `${param} = ${run.value}`,
          color: SWEEP_COLORS[i] as string,
          values: samples(quantity, run.simulation, count),
        });
      });
      charts.push({
        key: `${plot.id}/${index}`,
        plot: plot.id,
        title: plot.series.length > 1 ? `${plot.id}: ${series.source}` : plot.id,
        unit: unitLabel(series.quantity.dim, compiled.units),
        x,
        lines,
      });
    });
  }
  return charts;
}
