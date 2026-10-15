import { Document, documentSchema } from "@mekasim/core";
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

const StageTime = Expr.describe("How long the stage takes; seconds unless a unit is given");
const Force = z.tuple([Expr, Expr]).describe("The force as [fx, fy], such as [-500 N, 0]");

/** One stage of a move: the body is carried to a pose, or let go and pulled. */
export const MoveStage = z.union(
  [
    z.strictObject({
      to: z.tuple([Expr, Expr, Expr]).describe("The pose it goes to, as [x, y, angle]"),
      via: z
        .tuple([Expr, Expr])
        .optional()
        .describe("A place its frame passes on the way, along an arc; a straight line without it"),
      time: StageTime,
    }),
    z.strictObject({ pull: Force, time: StageTime }),
    z.strictObject({ push: Force, time: StageTime }),
  ],
  { error: "A stage has `to` and `time`, or `pull` or `push` and `time`" },
);

/** A driver that carries a body through stages, starting from its pose. */
export const Move = z.strictObject({
  move: Id.describe("The body to carry"),
  stages: z.array(MoveStage).min(1),
});

/** The two ends a joint may go between; either may be `null`. */
const Stops = z
  .tuple([Expr.nullable(), Expr.nullable()])
  .describe("The least and the most of the joint's angle or travel; null leaves an end open");

/** A lock that drops in behind a joint and then holds it. */
export const Latch = z.strictObject({
  joint: Id.describe("A revolute joint, pin-slot or slider"),
  at: Expr.describe("The angle or travel at which it drops in"),
  drops: z
    .enum(["down", "up"])
    .describe(
      "down: in once the value falls below `at`, holding it below; up: the other way round",
    ),
  engaged: z
    .boolean()
    .optional()
    .describe(
      "Whether it is in at the start; left out, it is in where the joint starts beyond its place",
    ),
});

/** How one parameter is varied over the runs of a study. */
export const Range = z.union(
  [
    z.strictObject({
      from: Expr.describe("The least value"),
      to: Expr.describe("The most value"),
      steps: z
        .int()
        .min(2)
        .max(1000)
        .optional()
        .describe("For `sample: grid`: how many values, evenly from `from` to `to`"),
    }),
    z.strictObject({
      mean: Expr.describe("The value most runs lie near"),
      spread: Expr.describe(
        "The standard deviation; the values are cut off at the parameter's bounds",
      ),
    }),
    z.strictObject({ pick: z.array(Expr).min(1).describe("Values, each as likely") }),
  ],
  { error: "A range is `from` and `to`, `mean` and `spread`, or `pick` with a list of values" },
);

/** A study: the model solved many times with some parameters varied, each run tested. */
export const Study = z.strictObject({
  runs: z.int().min(1).max(100000).optional().describe("How many runs; default 100"),
  seed: z
    .int()
    .optional()
    .describe("Starting number for the random draws; the same seed gives the same runs"),
  sample: z
    .enum(["random", "spread", "grid"])
    .optional()
    .describe(
      "random; spread (default), covering the ranges evenly; grid, every combination of `steps` values",
    ),
  vary: z
    .union([z.array(Id).min(1), z.record(Id, Range)])
    .describe(
      "The parameters to vary: a list, each over its own min to max, or a map with a range for each",
    ),
  pass: z
    .record(Id, z.string())
    .optional()
    .describe("Conditions for this study alone, written as checks are, tested instead of `checks`"),
});

/** mekasim's own driver, which turns a joint. */
const Motor = Document.shape.drivers.unwrap().valueType;

/**
 * A mekafit document: mekasim's, with another first line and the sections and fields
 * that `docs/mekafit/FORMAT.md` adds, as far as they are built.
 */
export const FitDocument = documentSchema({
  version: { key: FORMAT, value: FORMAT_VERSION },
  joint: { stops: Stops.optional() },
  sections: {
    contacts: z.record(Id, Contact).optional(),
    latches: z.record(Id, Latch).optional(),
    springs: z.record(Id, Spring).optional(),
    studies: z.record(Id, Study).optional(),
    // The move driver is mekafit's alone, so the whole section is given again with it in.
    drivers: z
      .record(
        Id,
        z.union([Motor, Move], {
          error:
            "A driver turns a joint, with `joint` and `speed`, or carries a body, with `move` and `stages`",
        }),
      )
      .optional(),
  },
});
