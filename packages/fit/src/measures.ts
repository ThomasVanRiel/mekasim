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
