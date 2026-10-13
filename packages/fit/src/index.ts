export { compileShapes, type FitModel } from "./compile.ts";
export { intersections } from "./geometry/intersect.ts";
export { checkLoops, shapeOf } from "./geometry/outline.ts";
export { arcBetween, OutlineError, parsePath, writePath } from "./geometry/path.ts";
export {
  type Box,
  circleLoop,
  endOf,
  insideLoop,
  insideShape,
  type Loop,
  loopArea,
  loopBounds,
  type Placement,
  type Point,
  placeLoop,
  placeShape,
  type Segment,
  type Shape,
  startOf,
  windingOf,
} from "./geometry/shape.ts";
export { asMekasim, load } from "./load.ts";
export { type FitBody, FitDocument, FORMAT, FORMAT_VERSION, type ShapeSource } from "./schema.ts";
export { type FitSimulation, shapeBounds, simulate, sweep } from "./simulate.ts";
