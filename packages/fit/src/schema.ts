import { documentSchema } from "@mekasim/core";
import * as z from "zod";

/** The key of a mekafit model's first line, and the version it carries. */
export const FORMAT = "mekafit";
export const FORMAT_VERSION = 1;

const Id = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Names may contain letters, digits and _ and must not start with a digit",
  );

/** One named set of bodies that the model allows to touch. */
export const Contact = z.union(
  [z.strictObject({ between: z.tuple([Id, Id]) }), z.strictObject({ among: z.array(Id).min(2) })],
  { error: "A contact is between two bodies, or among a list of bodies" },
);

const Expr = z
  .union([z.number(), z.string()])
  .describe("A number or an expression over parameters, optionally with units: 40, 40 mm, 2 * r");

const PointRef = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/,
    "Expected a point written as body.point",
  )
  .describe("A point on a body, written as body.point");

/** A spring that turns a revolute joint, or one that pulls or pushes between two points. */
export const Spring = z.union(
  [
    z.strictObject({
      joint: Id.describe("The revolute joint it turns"),
      stiffness: Expr.describe("Torque for each angle it is turned, such as 0.02 N*m/rad"),
      rest: Expr.optional().describe("The joint angle at which it pushes nothing"),
      preload: Expr.optional().describe(
        "Instead of rest: its torque at the start, turning the joint the positive way",
      ),
    }),
    z.strictObject({
      connect: z.tuple([PointRef, PointRef]).describe("The two points it is hooked to"),
      stiffness: Expr.describe("Force for each length it is stretched, such as 2 N/mm"),
      length: Expr.optional().describe("The length at which it pushes nothing"),
      preload: Expr.optional().describe(
        "Instead of length: its force at the start, pulling the two points together",
      ),
    }),
  ],
  { error: "A spring is on a joint, or it connects two points" },
);

/**
 * A mekafit document: mekasim's, with another first line and the sections and fields
 * that `docs/mekafit/FORMAT.md` adds, as far as they are built.
 */
export const FitDocument = documentSchema({
  version: { key: FORMAT, value: FORMAT_VERSION },
  sections: {
    contacts: z.record(Id, Contact).optional(),
    springs: z.record(Id, Spring).optional(),
  },
});
