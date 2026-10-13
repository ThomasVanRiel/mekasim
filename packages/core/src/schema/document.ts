import * as z from "zod";
import { ANGLE_UNITS, LENGTH_UNITS } from "../expr/units.ts";

export const FORMAT_VERSION = 1;

/** Name of the fixed body. Its points are world coordinates. */
export const GROUND = "ground";

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const POINT_REF = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

const Id = z
  .string()
  .regex(ID, "Names may contain letters, digits and _ and must not start with a digit");

const Expr = z
  .union([z.number(), z.string()])
  .describe("A number or an expression over parameters, optionally with units: 40, 40 mm, 2 * r");

const Param = z.union([
  Expr,
  z.strictObject({
    value: Expr,
    min: Expr.optional().describe("The least the value may be"),
    max: Expr.optional().describe("The most the value may be"),
  }),
]);

const PointRef = z
  .string()
  .regex(POINT_REF, "Expected a point written as body.point")
  .describe("A point on a body, written as body.point");

const Holes = z
  .record(Id, Expr)
  .optional()
  .describe("Round holes, each at a named point of the body, with its diameter");

const WrittenShape = z.strictObject({
  path: z
    .string()
    .describe(
      "Closed outlines as path text (M L H V A Z), in the body's frame and the document unit",
    ),
  holes: Holes,
});

const DrawnShape = z.strictObject({
  from: Id.describe("A drawing named under geometry"),
  layer: z
    .string()
    .optional()
    .describe("The layer of the drawing the outline is on, with the outlines inside it cut out"),
  at: z
    .tuple([Expr, Expr])
    .optional()
    .describe("A point inside the wanted outline, in the drawing's coordinates"),
  place: z
    .tuple([Expr, Expr, Expr])
    .optional()
    .describe(
      "Where the body's own frame sits in the drawing, as [x, y, angle]; default [0, 0, 0]",
    ),
  holes: Holes,
});

const Shape = z
  .union([WrittenShape, DrawnShape], {
    error: "A shape is written out with path, or taken from a drawing with from",
  })
  .describe("The real outline of the body: one outline, with the outlines inside it cut out");

const Geometry = z.strictObject({
  file: z.string().describe("A DXF file, kept beside the model"),
  unit: z
    .enum(LENGTH_UNITS)
    .optional()
    .describe("Length unit of the drawing, when the file does not say"),
});

const Body = z.strictObject({
  points: z
    .record(Id, z.tuple([Expr, Expr]))
    .describe("Named points in the body's own frame, as [x, y]"),
  layer: z.int().optional().describe("Depth order for the 3D view; higher is nearer the viewer"),
  shape: Shape.optional(),
});

const Revolute = z.strictObject({
  type: z.literal("revolute"),
  connect: z.tuple([PointRef, PointRef]).describe("The two points pinned together"),
});

const Weld = z.strictObject({
  type: z.literal("weld"),
  connect: z.tuple([PointRef, PointRef]).describe("The two points held together"),
  angle: Expr.optional().describe("Angle of the second body relative to the first; default 0"),
});

const Axis = z
  .tuple([PointRef, PointRef])
  .describe("Two points on one body defining the line of travel");

const Slider = z.strictObject({
  type: z.literal("slider"),
  axis: Axis,
  point: PointRef.describe("Point on the sliding body that stays on the axis"),
  angle: Expr.optional().describe("Angle of the sliding body relative to the axis body; default 0"),
});

const PinSlot = z.strictObject({
  type: z.literal("pin-slot"),
  axis: Axis,
  point: PointRef.describe("Pin that stays on the axis; its body remains free to rotate"),
});

const Distance = z.strictObject({
  type: z.literal("distance"),
  connect: z.tuple([PointRef, PointRef]).describe("The two points kept a fixed distance apart"),
  length: Expr.describe("The distance between them"),
});

const Wheels = {
  connect: z
    .tuple([PointRef, PointRef])
    .describe("The centres of the two wheels, each a point on the body that turns"),
  sizes: z
    .tuple([Expr, Expr])
    .describe("Tooth counts or diameters of the two wheels; only their ratio matters"),
  carrier: Id.optional().describe("The body that carries both axes; ground when left out"),
};

const Gear = z.strictObject({ type: z.literal("gear"), ...Wheels });
const Belt = z.strictObject({ type: z.literal("belt"), ...Wheels });

const Cam = z.strictObject({
  type: z.literal("cam"),
  cam: PointRef.describe("The centre of the cam, a point on the cam's body"),
  follower: PointRef.describe("The point of the follower that rides on the cam: its roller centre"),
  base: Expr.describe("Distance from the cam centre to the follower at zero lift"),
  profile: z
    .array(z.tuple([Expr, Expr]))
    .describe("The lift diagram: [angle, lift] pairs around the cam, in rising order of angle"),
  law: z
    .enum(["cycloidal", "harmonic", "polynomial"])
    .optional()
    .describe("How the lift moves between two pairs; default cycloidal"),
  roller: Expr.optional().describe("Radius of the follower's roller, for drawing; default 0"),
});

const JOINTS = [Revolute, Weld, Slider, PinSlot, Distance, Gear, Belt, Cam] as const;

function jointOf(kinds: typeof JOINTS) {
  return z.discriminatedUnion("type", kinds, {
    error:
      "Unknown joint type; expected revolute, weld, slider, pin-slot, distance, gear, belt or cam",
  });
}

const Joint = jointOf(JOINTS);

const Crank = z.strictObject({
  type: z.literal("crank"),
  at: z
    .union([z.tuple([Expr, Expr]), PointRef])
    .describe("Where it pivots: a fixed position [x, y], or a point on another body"),
  arms: z.record(Id, z.tuple([Expr, Expr])).describe("Named points, each as [radius, angle]"),
  angle: Expr.optional().describe("How far the whole crank is turned at the start; default 0"),
  speed: Expr.optional().describe("Drive it at this speed; rpm unless a unit is given"),
  layer: z.int().optional(),
});

const Rod = z.strictObject({
  type: z.literal("rod"),
  length: Expr.describe("Distance between its two ends"),
  connect: z.tuple([PointRef, PointRef]).describe("The points its ends A and B are pinned to"),
  points: z
    .record(Id, z.tuple([Expr, Expr]))
    .optional()
    .describe("Further points, in the rod's frame: A at [0, 0], B at [length, 0]"),
  layer: z.int().optional(),
});

const Component = z.discriminatedUnion("type", [Crank, Rod], {
  error: "Unknown component type; expected crank or rod",
});

const Driver = z.strictObject({
  joint: Id.describe("The revolute joint to drive"),
  speed: Expr.describe(
    "Constant speed of the second body relative to the first; rpm unless a unit is given",
  ),
  phase: Expr.optional().describe("Relative angle at time 0; default 0"),
});

const Frame = z.strictObject({
  origin: PointRef.optional().describe(
    "The point positions are counted from; the origin of the sheet when left out",
  ),
  angle: Expr.optional().describe("How far its x axis is turned; default 0"),
  along: z
    .tuple([PointRef, PointRef])
    .optional()
    .describe("Two points its x axis points along, from the first to the second"),
  body: Id.optional().describe("The body it turns with"),
});

function bodiesOf(body: typeof Body) {
  return z.record(Id, body).default({}).describe(`Rigid bodies. "${GROUND}" is the fixed one`);
}

function jointsOf(joint: typeof Joint) {
  return z.record(Id, joint).optional();
}

export const Document = z.strictObject({
  mekasim: z.literal(FORMAT_VERSION).describe("Format version"),
  meta: z
    .strictObject({
      name: z.string().optional(),
      description: z.string().optional(),
      units: z
        .strictObject({
          length: z.enum(LENGTH_UNITS).optional(),
          angle: z.enum(ANGLE_UNITS).optional(),
        })
        .optional()
        .describe("Units for bare numbers and for results; default mm and deg"),
    })
    .optional(),
  params: z
    .record(Id, Param)
    .optional()
    .describe("Named values usable in any expression, each optionally with bounds"),
  geometry: z
    .record(Id, Geometry)
    .optional()
    .describe("The drawings the model takes outlines from, kept as files beside it"),
  bodies: bodiesOf(Body),
  components: z
    .record(Id, Component)
    .optional()
    .describe("Common parts given by their dimensions; each stands for a body and its joints"),
  joints: jointsOf(Joint),
  drivers: z.record(Id, Driver).optional(),
  traces: z.array(PointRef).optional().describe("Points whose paths are recorded"),
  frames: z
    .record(Id, Frame)
    .optional()
    .describe("Named coordinate systems that measures and plots can give positions in"),
  measures: z
    .record(Id, Expr)
    .optional()
    .describe("Named expressions evaluated over the motion cycle"),
  checks: z
    .record(Id, z.string())
    .optional()
    .describe("Named conditions that the motion has to meet, such as a stroke above a length"),
  plots: z
    .record(Id, z.union([z.string(), z.array(z.string()).min(1)]))
    .optional()
    .describe("Named charts; each is one expression or a list of them, drawn over the cycle"),
  fabrication: z
    .strictObject({
      width: Expr.optional().describe("Width of a link"),
      thickness: Expr.optional().describe("Thickness of the sheet or print"),
      hole: Expr.optional().describe("Diameter of the pins"),
      clearance: Expr.optional().describe("Added to the hole diameter so that a pin turns freely"),
    })
    .optional()
    .describe("Real dimensions of the parts, for drawing them true to size and exporting them"),
  cycle: z
    .strictObject({
      steps: z.int().min(1).max(100000).optional().describe("Samples per cycle; default 360"),
      revolutions: z
        .number()
        .positive()
        .optional()
        .describe("Driver revolutions per cycle; default 1"),
    })
    .optional(),
  pose: z
    .record(Id, z.tuple([Expr, Expr, Expr]))
    .optional()
    .describe("Starting position of bodies as [x, y, angle]; bodies left out start at [0, 0, 0]"),
});

export type Document = z.infer<typeof Document>;
export type Joint = z.infer<typeof Joint>;
export type Frame = z.infer<typeof Frame>;
export type Expr = z.infer<typeof Expr>;
export type Param = z.infer<typeof Param>;

/** The value of a parameter, whether it is written plainly or with bounds. */
export function paramValue(param: Param): Expr {
  return typeof param === "object" ? param.value : param;
}

/**
 * What another format built on this one adds to it. mekasim itself adds nothing, so
 * none of this is valid in a mekasim model.
 */
export interface SchemaExtra {
  /** The first line of the other format, such as `mekafit: 1`. A `mekasim: 1` file is still read. */
  version?: { key: string; value: number };
  /** Fields added to every body. */
  body?: z.ZodRawShape;
  /** Fields added to every joint. */
  joint?: z.ZodRawShape;
  /** Sections added beside `bodies`, `joints` and the rest. */
  sections?: z.ZodRawShape;
}

/**
 * The schema of a document: mekasim's own, or mekasim's with additions. What it reads
 * is typed as a mekasim document; the format that adds to it knows what it added.
 */
export function documentSchema(extra?: SchemaExtra): typeof Document {
  if (!extra) return Document;
  const { version } = extra;
  const body = extra.body ? Body.extend(extra.body) : Body;
  const joint = extra.joint
    ? jointOf(JOINTS.map((kind) => kind.extend(extra.joint ?? {})) as unknown as typeof JOINTS)
    : Joint;
  const extended = Document.extend({
    ...(version && {
      mekasim: Document.shape.mekasim.optional(),
      [version.key]: z.literal(version.value).optional().describe("Format version"),
    }),
    bodies: bodiesOf(body as typeof Body),
    joints: jointsOf(joint),
    ...extra.sections,
  });
  if (!version) return extended as unknown as typeof Document;
  return extended.refine(
    (doc) =>
      (doc.mekasim === undefined) !== ((doc as Record<string, unknown>)[version.key] === undefined),
    {
      error: `A model starts with "${version.key}: ${version.value}" or "mekasim: ${FORMAT_VERSION}"`,
    },
  ) as unknown as typeof Document;
}

export function jsonSchema(schema = Document): unknown {
  return z.toJSONSchema(schema);
}
