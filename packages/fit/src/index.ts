export { compileFit, compileSprings } from "./compile.ts";
export {
  type CompiledContact,
  type ContactCandidate,
  type ContactResult,
  compileContacts,
  contactDiagnostics,
  contactResults,
  type FitCompiled,
  type FitSimulation,
  findContacts,
  OVERLAP_TOLERANCE,
  pairKey,
} from "./contacts.ts";
export { addContacts, asFitText, hasContact } from "./edit.ts";
export {
  CONTACT_MARGIN,
  CONTACT_MERGE,
  type ContactPoint,
  contactPoints,
  MAX_CONTACT_POINTS,
} from "./geometry/contacts.ts";
export { asMekasim, load } from "./load.ts";
export {
  FIT_REGISTRY,
  FORCE,
  FORCE_UNITS,
  LINEAR_STIFFNESS,
  TORQUE,
  TORSIONAL_STIFFNESS,
} from "./registry.ts";
export { FitDocument, FORMAT, FORMAT_VERSION } from "./schema.ts";
export { keepOutlines, simulate, sweep } from "./simulate.ts";
export {
  type CompiledLock,
  type CompiledStop,
  contactInequalities,
  contactInequality,
  type Inequality,
  type InequalityKind,
  type JointValue,
  jointValue,
  type LinearizedInequalities,
  linearizeInequalities,
  lockInequalities,
  stopInequalities,
} from "./solver/inequality.ts";
export { type QpSolution, solveQp } from "./solver/qp.ts";
export { type Jam, type QuasistaticRun, solveQuasistatic } from "./solver/quasistatic.ts";
export {
  type CompiledSpring,
  type SpringTerms,
  type StraightSpring,
  springTerms,
  springValue,
  type TorsionSpring,
} from "./solver/springs.ts";
export {
  type CompiledMove,
  moveConstraint,
  moveDuration,
  poseAt,
  type Stage,
  type ToStage,
} from "./solver/stages.ts";
