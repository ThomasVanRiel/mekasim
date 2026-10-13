import type { Compiled, CompiledBody } from "../compile/compile.ts";
import { type Gap, gap, type Pose } from "../geometry/distance.ts";
import type { Cycle } from "./cycle.ts";

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

/** The gap between the shapes of two bodies over the motion. */
export interface MeasuredGap {
  /** The two bodies, as the model names them. */
  a: string;
  b: string;
  /** The gap at every sample, with the two places it is between. */
  gaps: Gap[];
  /**
   * Whether a pin joins the two. Such a pair lies over each other round its pin by
   * the way it is built, so an overlap between them is not counted: their gap is
   * nothing there, never less.
   */
  pinned: boolean;
  /** At how many samples a pinned pair lies over each other. */
  over: number;
  /** Where in the model the gap is first asked for. */
  asked: (string | number)[];
}

/** Whether a pin joins two bodies. */
export function pinned(compiled: Compiled, a: string, b: string): boolean {
  return compiled.joints.some((joint) => {
    if (joint.type !== "revolute") return false;
    const bodies = joint.points.map((point) => point.split(".")[0]);
    return bodies.includes(a) && bodies.includes(b);
  });
}

/**
 * The gap between the shapes of two bodies at every sample of the motion. Nothing
 * when one of them has no shape.
 */
export function gapsOf(
  compiled: Compiled,
  cycle: Cycle,
  a: string,
  b: string,
  asked: (string | number)[] = [],
): MeasuredGap | undefined {
  const first = compiled.bodies.get(a);
  const second = compiled.bodies.get(b);
  if (!first?.shape || !second?.shape) return undefined;
  const joined = pinned(compiled, a, b);
  const gaps: Gap[] = [];
  let over = 0;
  for (let k = 0; k < cycle.count; k++) {
    const found = gap(
      first.shape,
      poseOf(first, cycle, k),
      second.shape,
      poseOf(second, cycle, k),
    ) as Gap;
    if (joined && found.distance < 0) {
      over++;
      // Shown as no gap at one place, not as a line through the overlap.
      gaps.push({ distance: 0, a: found.a, b: found.a });
    } else gaps.push(found);
  }
  return { a, b, gaps, pinned: joined, over, asked };
}
