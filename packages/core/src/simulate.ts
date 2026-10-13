import { type Cycle, solveCycle } from "./analysis/cycle.ts";
import { assignLayers } from "./analysis/layers.ts";
import {
  type CheckResult,
  evaluateMeasures,
  type MeasureResult,
  type PlotResult,
} from "./analysis/measures.ts";
import { modelExtent, motionBounds, partSizes } from "./analysis/sizes.ts";
import { type Compiled, compile } from "./compile/compile.ts";
import { type Diagnostic, hasErrors } from "./diagnostics.ts";
import { type Files, type Resolved, resolveShapes } from "./drawing/resolve.ts";
import type { Registry } from "./registry.ts";
import type { Document } from "./schema/document.ts";
import { load } from "./schema/load.ts";
import { analyzeMobility, type Mobility } from "./solver/mobility.ts";

export interface Simulation extends Omit<Resolved, "doc"> {
  diagnostics: Diagnostic[];
  /** The document as it is compiled: with every shape from a drawing written out. */
  doc?: Document;
  compiled?: Compiled;
  cycle?: Cycle;
  /** Degrees of freedom at the starting position; absent when it cannot be assembled. */
  mobility?: Mobility;
  measures: MeasureResult[];
  /** Whether each condition under `checks` is met. One that is not is a result, not a problem. */
  checks: CheckResult[];
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

/**
 * Where a format built on mekasim comes into the pipeline. mekasim gives none of
 * them, and `simulate(text)` is then what it always was.
 */
export interface SimulateOptions {
  /** The schema to read the text with, from `documentSchema`. */
  schema?: Parameters<typeof load>[1];
  /** The drawings kept beside the model, by the file names the model gives them. */
  files?: Files;
  /** Units and functions added to the expressions. */
  registry?: Registry;
  /**
   * Rewrites the document once it is read and before it is compiled: what the other
   * format writes in its own way is put in mekasim's. A problem it reports as an
   * error stops there.
   */
  prepare?(doc: Document, report: (diagnostic: Diagnostic) => void): Document;
  /**
   * Adds to the compiled model before it is solved, from what the document holds
   * beyond mekasim's. A problem it reports as an error stops the solve.
   */
  extend?(compiled: Compiled, doc: Document, report: (diagnostic: Diagnostic) => void): void;
  /** Solves the motion in place of `solveCycle`. */
  solve?(compiled: Compiled): Cycle;
}

const NO_FILES: Files = new Map();

/** Everything from model text to results: load, compile, solve a cycle, evaluate measures. */
export function simulate(text: string, options: SimulateOptions = {}): Simulation {
  const loaded = load(text, options.schema);
  const diagnostics = [...loaded.diagnostics];
  const simulation: Simulation = {
    diagnostics,
    measures: [],
    checks: [],
    plots: [],
    drawings: new Map(),
    missing: [],
    sources: {},
    uses: [],
  };
  if (!loaded.doc) return simulation;
  const report = (diagnostic: Diagnostic): void => {
    diagnostics.push(diagnostic);
  };
  // Shapes that come from drawings are written into the document first, as path text.
  const { doc: resolved, ...drawn } = resolveShapes(loaded.doc, options.files ?? NO_FILES, report);
  Object.assign(simulation, drawn);
  const doc = options.prepare?.(resolved, report) ?? resolved;
  simulation.doc = doc;

  const { compiled, diagnostics: compileDiagnostics } = hasErrors(diagnostics)
    ? { compiled: undefined, diagnostics: [] }
    : compile(doc, options.registry);
  diagnostics.push(...compileDiagnostics);
  if (compiled && !hasErrors(diagnostics)) {
    options.extend?.(compiled, doc, (diagnostic) => diagnostics.push(diagnostic));
  }
  if (compiled && !hasErrors(diagnostics)) {
    simulation.compiled = compiled;
    const cycle =
      options.solve?.(compiled) ?? solveCycle(compiled.model, compiled.period, compiled.steps);
    simulation.cycle = cycle;

    if (cycle.count > 0) {
      // Layers depend on where the bodies go, so they are settled once the motion is known.
      const sizes = partSizes(compiled, modelExtent(compiled, motionBounds(compiled, cycle)));
      assignLayers(compiled, cycle, sizes.half);
      simulation.mobility = analyzeMobility(compiled.model, cycle.q.subarray(0, cycle.width));
      diagnostics.push(...mobilityDiagnostics(simulation.mobility, compiled));
      const results = evaluateMeasures(compiled, cycle, options.registry);
      simulation.measures = results.measures;
      simulation.checks = results.checks;
      simulation.plots = results.plots;
      for (const measure of simulation.measures) {
        if (measure.error)
          diagnostics.push({
            severity: "error",
            message: measure.error,
            path: ["measures", measure.id],
          });
      }
      for (const check of simulation.checks) {
        if (check.error)
          diagnostics.push({
            severity: "error",
            message: check.error,
            path: ["checks", check.id],
          });
      }
      for (const plot of simulation.plots) {
        const listed = typeof doc.plots?.[plot.id] !== "string";
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
      const section = first !== undefined && doc.drivers?.[first] ? "drivers" : "joints";
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
