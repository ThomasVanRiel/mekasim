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

const PointRef = z
  .string()
  .regex(POINT_REF, "Expected a point written as body.point")
  .describe("A point on a body, written as body.point");

const Body = z.strictObject({
  points: z
    .record(Id, z.tuple([Expr, Expr]))
    .describe("Named points in the body's own frame, as [x, y]"),
  layer: z.int().optional().describe("Depth order for the 3D view; higher is nearer the viewer"),
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

const Joint = z.discriminatedUnion("type", [Revolute, Weld, Slider, PinSlot], {
  error: "Unknown joint type; expected revolute, weld, slider or pin-slot",
});

const Driver = z.strictObject({
  joint: Id.describe("The revolute joint to drive"),
  speed: Expr.describe(
    "Constant speed of the second body relative to the first; rpm unless a unit is given",
  ),
  phase: Expr.optional().describe("Relative angle at time 0; default 0"),
});

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
  params: z.record(Id, Expr).optional().describe("Named values usable in any expression"),
  bodies: z.record(Id, Body).describe(`Rigid bodies. "${GROUND}" is the fixed one`),
  joints: z.record(Id, Joint).optional(),
  drivers: z.record(Id, Driver).optional(),
  traces: z.array(PointRef).optional().describe("Points whose paths are recorded"),
  measures: z
    .record(Id, Expr)
    .optional()
    .describe("Named expressions evaluated over the motion cycle"),
  plots: z
    .record(Id, z.union([z.string(), z.array(z.string()).min(1)]))
    .optional()
    .describe("Named charts; each is one expression or a list of them, drawn over the cycle"),
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
export type Expr = z.infer<typeof Expr>;

export function jsonSchema(): unknown {
  return z.toJSONSchema(Document);
}
