import {
  type Compiled,
  type CompiledBody,
  type Cycle,
  ExprError,
  type Node,
  type Registry,
} from "@mekasim/core";
import { type Gap, gap, type Pose } from "./geometry/distance.ts";

const LENGTH = [1, 0, 0, 0] as [number, number, number, number];

/** Where a body is at one sample of the motion. */
export function poseOf(body: CompiledBody, cycle: Cycle, sample: number): Pose {
  // The ground does not move, and is where the sheet is.
  if (body.index < 0) return { x: 0, y: 0, angle: 0 };
  const at = sample * cycle.width + 3 * body.index;
  return {
    x: cycle.q[at] as number,
    y: cycle.q[at + 1] as number,
    angle: cycle.q[at + 2] as number,
  };
}

/**
 * The gap between the shapes of two bodies at every sample of the motion, with the
 * two places it is between. Nothing when one of them has no shape.
 */
export function gapsOf(compiled: Compiled, cycle: Cycle, a: string, b: string): Gap[] | undefined {
  const first = compiled.bodies.get(a);
  const second = compiled.bodies.get(b);
  if (!first?.shape || !second?.shape) return undefined;
  const gaps: Gap[] = [];
  for (let k = 0; k < cycle.count; k++) {
    gaps.push(
      gap(first.shape, poseOf(first, cycle, k), second.shape, poseOf(second, cycle, k)) as Gap,
    );
  }
  return gaps;
}

function shaped(compiled: Compiled, arg: Node | undefined, call: Node): string {
  if (arg?.kind !== "ref") {
    throw new ExprError(
      "gap() takes the names of two bodies, as in gap(knuckle, head)",
      (arg ?? call).pos,
    );
  }
  const body = compiled.bodies.get(arg.name);
  if (!body) throw new ExprError(`Unknown body "${arg.name}"`, arg.pos);
  if (!body.shape) {
    throw new ExprError(
      `"${arg.name}" has no shape, so there is no gap to measure to it. Give it one with shape:`,
      arg.pos,
    );
  }
  return arg.name;
}

/** The functions mekafit adds to mekasim's expressions. */
export const registry: Registry = {
  functions: {
    gap({ args, node, compiled, cycle }) {
      if (args.length !== 2) {
        throw new ExprError(
          `gap() takes the names of two bodies, as in gap(knuckle, head), got ${args.length}`,
          node.pos,
        );
      }
      const a = shaped(compiled, args[0], node);
      const b = shaped(compiled, args[1], node);
      if (a === b) {
        throw new ExprError(`gap() is between two bodies, and "${a}" is given twice`, node.pos);
      }
      const gaps = gapsOf(compiled, cycle, a, b) as Gap[];
      return { value: Float64Array.from(gaps, (found) => found.distance), dim: LENGTH };
    },
  },
};

/** A gap that the model asks about, at every sample of the motion. */
export interface MeasuredGap {
  /** The two bodies, as the model names them. */
  a: string;
  b: string;
  gaps: Gap[];
}

/** Every call of a function in an expression, wherever it stands in it. */
function callsOf(node: Node, name: string, found: (Node & { kind: "call" })[] = []) {
  if (node.kind === "call") {
    if (node.name === name) found.push(node);
    for (const arg of node.args) callsOf(arg, name, found);
  } else if (node.kind === "neg" || node.kind === "not") callsOf(node.arg, name, found);
  else if (node.kind === "bin" || node.kind === "compare" || node.kind === "logic") {
    callsOf(node.left, name, found);
    callsOf(node.right, name, found);
  }
  return found;
}

/**
 * The gaps that the measures, checks and plots of a model ask about, each pair of
 * bodies once, for drawing them where they are measured.
 */
export function measuredGaps(compiled: Compiled, cycle: Cycle): MeasuredGap[] {
  const asked = [
    ...compiled.measures.map((measure) => measure.ast),
    ...compiled.checks.map((check) => check.ast),
    ...compiled.plots.flatMap((plot) => plot.series.map((series) => series.ast)),
  ];
  const found = new Map<string, MeasuredGap>();
  for (const ast of asked) {
    for (const call of callsOf(ast, "gap")) {
      const [a, b] = call.args.map((arg) => (arg.kind === "ref" ? arg.name : undefined));
      if (a === undefined || b === undefined || a === b) continue;
      const key = [a, b].sort().join(" ");
      if (found.has(key)) continue;
      const gaps = gapsOf(compiled, cycle, a, b);
      if (gaps) found.set(key, { a, b, gaps });
    }
  }
  return [...found.values()];
}
