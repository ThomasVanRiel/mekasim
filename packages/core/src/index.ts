export { toCsv } from "./analysis/csv.ts";
export {
  type Cycle,
  type CycleFailure,
  cycleFromPositions,
  cycleJerk,
  solveCycle,
} from "./analysis/cycle.ts";
export { assignLayers, hullDistance } from "./analysis/layers.ts";
export {
  type CheckResult,
  centreOf,
  cycleAxis,
  evaluateMeasures,
  type MeasureResult,
  type PlotResult,
  type PlotSeries,
  type PointJerk,
  type PointMotion,
  pointJerk,
  pointMotion,
} from "./analysis/measures.ts";
export {
  type Bounds,
  modelExtent,
  motionBounds,
  type PartSizes,
  partSizes,
  pinDiameters,
} from "./analysis/sizes.ts";
export { type SweepRun, sweep } from "./analysis/sweep.ts";
export {
  type Compiled,
  type CompiledBody,
  type CompiledDriver,
  type CompiledFrame,
  type CompiledJoint,
  type CompileResult,
  compile,
} from "./compile/compile.ts";
export { type Diagnostic, hasErrors, type Position, type Severity } from "./diagnostics.ts";
export {
  type Entity,
  entityAt,
  type LinkedName,
  linkedAt,
  type NameKind,
  type Span,
} from "./edit/linked.ts";
export {
  addBody,
  addComponent,
  addDriver,
  addFrame,
  addJoint,
  addMeasure,
  addPlot,
  addPoint,
  addRevolute,
  type Coord,
  driversOf,
  editText,
  findRevolute,
  freeName,
  jointRefs,
  movePoint,
  NEW_MODEL,
  nameMeasure,
  removeBody,
  removeJoint,
  removePoint,
  setPose,
  tidy,
  toggleTrace,
} from "./edit/operations.ts";
export { type Edit, EditError, type Path, type Value } from "./edit/patch.ts";
export { type EvalContext, evaluate, type Quantity, toSI } from "./expr/evaluate.ts";
export { ExprError, type Node, parseExpr } from "./expr/parse.ts";
export {
  ANGLE,
  type Dim,
  docFactor,
  formatQuantity,
  LENGTH,
  NONE,
  UNITS,
  type UnitDef,
  type Units,
  unitLabel,
} from "./expr/units.ts";
export { toDxf, toPointsDxf } from "./fabricate/dxf.ts";
export {
  buildParts,
  checkFabrication,
  type Fabrication,
  type Hole,
  layoutParts,
  type Part,
  type Slot,
  slotOutline,
} from "./fabricate/parts.ts";
export { intersections } from "./geometry/intersect.ts";
export { convexHull, type Point, plateOutline } from "./geometry/outline.ts";
export { arcBetween, OutlineError, parsePath, writePath } from "./geometry/path.ts";
export {
  alongArc,
  type Box,
  circleLoop,
  emptyBox,
  endOf,
  flattenLoop,
  insideLoop,
  insideShape,
  type Loop,
  lengthOf,
  loopArea,
  loopBounds,
  type Placement,
  placeLoop,
  placeShape,
  pointAt,
  reach,
  reverseLoop,
  type Segment,
  type Shape,
  segmentBounds,
  startOf,
  windingOf,
} from "./geometry/shape.ts";
export { checkLoops, shapeOf } from "./geometry/validate.ts";
export type { FunctionCall, Registry } from "./registry.ts";
export {
  Document,
  documentSchema,
  FORMAT_VERSION,
  type Frame,
  GROUND,
  jsonSchema,
  type Param,
  paramValue,
  type SchemaExtra,
} from "./schema/document.ts";
export { type Loaded, load } from "./schema/load.ts";
export { type SimulateOptions, type Simulation, simulate } from "./simulate.ts";
// What a solver built on this one works with: the constraints and the linear algebra.
export {
  angleCoupling,
  type BodyPoint,
  type Constraint,
  coincident,
  distance,
  GROUND_INDEX,
  type Placed,
  place,
  pointOnLine,
  relativeAngle,
} from "./solver/constraints.ts";
export { dragTo } from "./solver/drag.ts";
export {
  type Mat,
  mat,
  matFrom,
  nullSpace,
  pinvSolve,
  RANK_TOLERANCE,
  rankOf,
  type Svd,
  solveLinear,
  svd,
} from "./solver/linalg.ts";
export { analyzeMobility, type Mobility } from "./solver/mobility.ts";
export {
  jacobian,
  type PositionResult,
  residual,
  rowCount,
  type SolverModel,
  solveAcceleration,
  solveJerk,
  solvePosition,
  solveVelocity,
  TOLERANCE,
} from "./solver/solve.ts";
