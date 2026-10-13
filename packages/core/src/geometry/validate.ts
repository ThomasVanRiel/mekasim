import { intersections } from "./intersect.ts";
import { OutlineError, placeText } from "./path.ts";
import {
  endOf,
  insideLoop,
  type Loop,
  lengthOf,
  loopArea,
  loopBounds,
  type Point,
  reach,
  reverseLoop,
  type Shape,
  startOf,
} from "./shape.ts";

function apart(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Check that loops are outlines a part can have: each closed, with no segment of no
 * length, and none crossing itself or another. `tolerance` is how near two places
 * count as one, in the unit of the loops. Throws an `OutlineError` at the first problem.
 */
export function checkLoops(loops: Loop[], tolerance: number): void {
  for (const loop of loops) {
    loop.segments.forEach((segment, i) => {
      if (lengthOf(segment) <= tolerance) {
        const at = startOf(segment);
        throw new OutlineError(`A segment at ${placeText(at)} has no length`, { at });
      }
      const next = loop.segments[(i + 1) % loop.segments.length] ?? segment;
      const end = endOf(segment);
      if (apart(end, startOf(next)) > tolerance) {
        throw new OutlineError(`The outline is open at ${placeText(end)}`, { at: end });
      }
    });
  }

  loops.forEach((loop, l) => {
    loop.segments.forEach((segment, i) => {
      for (let m = l; m < loops.length; m++) {
        const other = loops[m] as Loop;
        for (let j = m === l ? i + 1 : 0; j < other.segments.length; j++) {
          const against = other.segments[j] as (typeof other.segments)[number];
          // Neighbours on one loop meet at the place where one ends and the next starts.
          const joints: Point[] = [];
          if (m === l) {
            const n = loop.segments.length;
            if (j === i + 1) joints.push(endOf(segment));
            if (i === 0 && j === n - 1) joints.push(startOf(segment));
          }
          for (const at of intersections(segment, against, tolerance)) {
            if (joints.some((joint) => apart(joint, at) <= 2 * tolerance)) continue;
            throw new OutlineError(
              m === l
                ? `The outline crosses itself at ${placeText(at)}`
                : `Two outlines cross at ${placeText(at)}`,
              { at },
            );
          }
        }
      }
    });
  });
}

/**
 * A shape from its outlines: the largest is the outside, the others are holes and
 * must lie inside it. The outside is turned anticlockwise and the holes clockwise.
 */
export function shapeOf(loops: Loop[], tolerance: number): Shape {
  checkLoops(loops, tolerance);
  const sized = loops.map((loop) => ({ loop, area: loopArea(loop) }));
  const outside = sized.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const outer = outside.area < 0 ? reverseLoop(outside.loop) : outside.loop;
  const holes: Loop[] = [];
  for (const { loop, area } of sized) {
    if (loop === outside.loop) continue;
    // Outlines do not cross, so a hole is inside when any one place on it is.
    const at = startOf(loop.segments[0] as (typeof loop.segments)[number]);
    if (!insideLoop(outer, at[0], at[1])) {
      throw new OutlineError(
        `The outline at ${placeText(at)} lies outside the part's outline. A shape is one outline with holes in it`,
        { at },
      );
    }
    if (holes.some((hole) => insideLoop(hole, at[0], at[1]))) {
      throw new OutlineError(`The hole at ${placeText(at)} lies inside another hole`, { at });
    }
    holes.push(area > 0 ? reverseLoop(loop) : loop);
  }
  return { outer, holes, bounds: loopBounds(outer), radius: reach(outer) };
}
