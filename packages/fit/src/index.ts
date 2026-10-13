export {
  type Gap,
  gap,
  type Nearest,
  nearest,
  nearestOn,
  nearestOnShape,
  type Pose,
} from "./geometry/distance.ts";
export { type Tree, treeOf } from "./geometry/tree.ts";
export { asMekasim, load } from "./load.ts";
export { gapsOf, type MeasuredGap, measuredGaps, poseOf, registry } from "./measures.ts";
export { FitDocument, FORMAT, FORMAT_VERSION } from "./schema.ts";
export { keepOutlines, simulate, sweep } from "./simulate.ts";
