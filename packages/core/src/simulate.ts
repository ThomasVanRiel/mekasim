import { type Cycle, solveCycle } from "./analysis/cycle.ts";
import { evaluateMeasures, type MeasureResult, type PlotResult } from "./analysis/measures.ts";
import { type Compiled, compile } from "./compile/compile.ts";
import { type Diagnostic, hasErrors } from "./diagnostics.ts";
import type { Document } from "./schema/document.ts";
import { load } from "./schema/load.ts";
import { analyzeMobility, type Mobility } from "./solver/mobility.ts";

export interface Simulation {
  diagnostics: Diagnostic[];
  doc?: Document;
  compiled?: Compiled;
  cycle?: Cycle;
  /** Degrees of freedom at the starting position; absent when it cannot be assembled. */
  mobility?: Mobility;
  measures: MeasureResult[];
  plots: PlotResult[];
}

function list(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function mobilityDiagnostics(mobility: Mobility, compiled: Compiled): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const driven = compiled.model.constraints.some((c) => c.driver);

  for (const id of mobility.blockedDrivers) {
    diagnostics.push({
      severity: "error",
      message: `Driver "${id}" has nothing to move: the joints alone already fix the bodies it acts on`,
      path: ["drivers", id],
    });
  }
  if (mobility.free > 0) {
    const what = plural(mobility.free, "degree");
    diagnostics.push({
      severity: "warning",
      message: driven
        ? `${what} of freedom not driven, so the motion is not fully determined. Free to move: ${list(mobility.freeBodies)}`
        : `${what} of freedom and no driver: only the starting position is solved. Add a driver to see motion`,
      path: driven ? ["drivers"] : undefined,
    });
  }
  if (mobility.redundant > 0) {
    diagnostics.push({
      severity: "info",
      message: `${plural(mobility.redundant, "redundant constraint")}: the motion is unaffected, but joint forces will not be unique. Involved: ${list(mobility.redundantSources)}`,
      path: ["joints"],
    });
  }
  return diagnostics;
}

/** Everything from model text to results: load, compile, solve a cycle, evaluate measures. */
export function simulate(text: string): Simulation {
  const loaded = load(text);
  const diagnostics = [...loaded.diagnostics];
  const simulation: Simulation = { diagnostics, measures: [], plots: [] };
  if (!loaded.doc) return simulation;
  simulation.doc = loaded.doc;

  const { compiled, diagnostics: compileDiagnostics } = compile(loaded.doc);
  diagnostics.push(...compileDiagnostics);
  if (compiled && !hasErrors(diagnostics)) {
    simulation.compiled = compiled;
    const cycle = solveCycle(compiled.model, compiled.period, compiled.steps);
    simulation.cycle = cycle;

    if (cycle.count > 0) {
      simulation.mobility = analyzeMobility(compiled.model, cycle.q.subarray(0, cycle.width));
      diagnostics.push(...mobilityDiagnostics(simulation.mobility, compiled));
      const results = evaluateMeasures(compiled, cycle);
      simulation.measures = results.measures;
      simulation.plots = results.plots;
      for (const measure of simulation.measures) {
        if (measure.error)
          diagnostics.push({
            severity: "error",
            message: measure.error,
            path: ["measures", measure.id],
          });
      }
      for (const plot of simulation.plots) {
        const listed = typeof loaded.doc.plots?.[plot.id] !== "string";
        plot.series.forEach((series, i) => {
          if (series.error)
            diagnostics.push({
              severity: "error",
              message: series.error,
              path: listed ? ["plots", plot.id, i] : ["plots", plot.id],
            });
        });
      }
    }

    // A blocked driver is already reported, and is the reason the motion stops.
    if (cycle.failure && !simulation.mobility?.blockedDrivers.length) {
      const { failure } = cycle;
      const first = failure.open[0];
      const open = failure.open.length > 0 ? `; cannot close ${list(failure.open)}` : "";
      const message =
        failure.step === 0
          ? `The mechanism cannot be assembled from its starting position${open}`
          : `The mechanism locks up at step ${failure.step} of ${cycle.steps} (t = ${failure.time.toPrecision(4)} s)${open}`;
      const section = first !== undefined && loaded.doc.drivers?.[first] ? "drivers" : "joints";
      diagnostics.push({
        severity: "error",
        message,
        path: first === undefined ? undefined : [section, first],
      });
    }
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.path && !diagnostic.position)
      diagnostic.position = loaded.locate(diagnostic.path);
  }
  return simulation;
}
