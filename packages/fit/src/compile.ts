import {
  ANGLE,
  type BodyPoint,
  type Compiled,
  type Diagnostic,
  type Dim,
  type Document,
  ExprError,
  evaluate,
  LENGTH,
  NONE,
  parseExpr,
  type Quantity,
  solvePosition,
  toSI,
} from "@mekasim/core";
import type * as z from "zod";
import { compileContacts, type FitCompiled } from "./contacts.ts";
import { FORCE, FORCE_UNITS, LINEAR_STIFFNESS, TORQUE, TORSIONAL_STIFFNESS } from "./registry.ts";
import type { Move, Spring } from "./schema.ts";
import { type CompiledSpring, springValue } from "./solver/springs.ts";
import { type CompiledMove, moveConstraint, moveDuration, type Stage } from "./solver/stages.ts";

type SpringEntry = z.infer<typeof Spring>;
type MoveEntry = z.infer<typeof Move>;
type DriverEntry = NonNullable<Document["drivers"]>[string] | MoveEntry;
type Report = (diagnostic: Diagnostic) => void;
type Path = (string | number)[];
type Expr = number | string;

/** Raised for a problem that is already recorded as a diagnostic. */
class Reported extends Error {}

/** A mekafit document as `prepare` leaves it: the moves taken out of `drivers`, where core reads only its own. */
type Prepared = Document & {
  springs?: Record<string, SpringEntry>;
  moves?: Record<string, MoveEntry>;
};

/** Seconds; core keeps the dimension to itself. */
const TIME: Dim = [0, 1, 0, 0];

/**
 * Core's `prepare` hook. Core compiles the drivers that turn a joint, so those that
 * carry a body are set aside for `compileFit`, which gets this same document.
 */
export function prepareFit(source: Document): Document {
  const motors: Record<string, unknown> = {};
  const moves: Record<string, MoveEntry> = {};
  for (const [id, driver] of Object.entries(source.drivers ?? {}) as [string, DriverEntry][]) {
    if ("move" in driver) moves[id] = driver;
    else motors[id] = driver;
  }
  if (Object.keys(moves).length === 0) return source;
  return { ...source, drivers: motors, moves } as Prepared;
}

/** Everything mekafit adds to the compiled model, in core's `extend` hook. */
export function compileFit(compiled: Compiled, source: Document, report: Report): void {
  compileContacts(compiled, source, report);
  // The moves first: a spring's preload is taken where the joints and the moves put the bodies.
  compileMoves(compiled, source, report);
  compileSprings(compiled, source, report);
}

/** What reading a section needs: expressions with mekafit's units, and problems told at their place. */
function reader(compiled: Compiled, report: Report) {
  function fail(message: string, path: Path): Reported {
    report({ severity: "error", message, path });
    return new Reported(message);
  }

  function quantity(written: Expr, path: Path): Quantity {
    if (typeof written === "number") return { value: written, dim: NONE };
    try {
      return evaluate(parseExpr(written, FORCE_UNITS), {
        units: compiled.units,
        extraUnits: FORCE_UNITS,
        resolve(name, node) {
          const value = compiled.params.get(name);
          if (!value) throw new ExprError(`Unknown parameter "${name}"`, node.pos);
          return value;
        },
      });
    } catch (error) {
      if (error instanceof ExprError) throw fail(`${error.message} in "${written}"`, path);
      throw error;
    }
  }

  /** A length, an angle or a time, where a plain number is in the document's unit. */
  function scalar(written: Expr, dim: Dim, path: Path): number {
    try {
      return toSI(quantity(written, path), dim, compiled.units) as number;
    } catch (error) {
      if (error instanceof ExprError) throw fail(error.message, path);
      throw error;
    }
  }

  /**
   * A force, torque or stiffness. The document has no unit of its own for these, so
   * a plain number is not read; `kind` says what is wanted, with an example.
   */
  function load(written: Expr, dim: Dim, kind: string, path: Path): number {
    const { value, dim: found } = quantity(written, path);
    if (!found.every((exponent, i) => exponent === dim[i])) throw fail(kind, path);
    return value as number;
  }

  /** Run one entry, so that a problem in it does not hide the next. */
  function attempt(run: () => void): void {
    try {
      run();
    } catch (error) {
      if (!(error instanceof Reported)) throw error;
    }
  }

  return { fail, scalar, load, attempt };
}

/**
 * Read and check the `move` drivers. Each becomes a pose constraint in the model, so
 * that the body counts as driven, and the run lasts as long as the longest of them.
 */
export function compileMoves(compiled: Compiled, source: Document, report: Report): void {
  const doc = source as Prepared;
  const { fail, scalar, load, attempt } = reader(compiled, report);
  const moves: CompiledMove[] = [];
  const moved = new Set<string>();

  for (const [id, entry] of Object.entries(doc.moves ?? {})) {
    const path = ["drivers", id];
    attempt(() => {
      const body = compiled.bodies.get(entry.move);
      if (!body) throw fail(`Unknown body "${entry.move}"`, [...path, "move"]);
      if (body.index < 0)
        throw fail(`"${entry.move}" is fixed and cannot be moved`, [...path, "move"]);
      if (moved.has(entry.move))
        throw fail(`"${entry.move}" is already moved by another driver`, [...path, "move"]);
      moved.add(entry.move);

      const at = 3 * body.index;
      const { q0 } = compiled.model;
      const stages = entry.stages.map((stage, i): Stage => {
        const here = [...path, "stages", i];
        const time = scalar(stage.time, TIME, [...here, "time"]);
        if (!(time > 0)) throw fail("A stage's time must be more than zero", [...here, "time"]);
        const force = "pull" in stage ? stage.pull : "push" in stage ? stage.push : undefined;
        if (force) {
          const field = "pull" in stage ? "pull" : "push";
          const component = (k: 0 | 1): number =>
            force[k] === 0
              ? 0
              : load(force[k], FORCE, "A pull is a force, such as [-500 N, 0]", [
                  ...here,
                  field,
                  k,
                ]);
          return { kind: "pull", force: [component(0), component(1)], time };
        }
        const carried = stage as Extract<typeof stage, { to: unknown }>;
        return {
          kind: "to",
          to: {
            x: scalar(carried.to[0], LENGTH, [...here, "to", 0]),
            y: scalar(carried.to[1], LENGTH, [...here, "to", 1]),
            angle: scalar(carried.to[2], ANGLE, [...here, "to", 2]),
          },
          via: carried.via && [
            scalar(carried.via[0], LENGTH, [...here, "via", 0]),
            scalar(carried.via[1], LENGTH, [...here, "via", 1]),
          ],
          time,
        };
      });
      moves.push({
        id,
        body: body.index,
        start: { x: q0[at] as number, y: q0[at + 1] as number, angle: q0[at + 2] as number },
        stages,
      });
    });
  }

  for (const move of moves) compiled.model.constraints.push(moveConstraint(move));
  if (moves.length > 0) compiled.period = Math.max(...moves.map(moveDuration));
  (compiled as FitCompiled).moves = moves;
}

/** Read and check the springs, with every value in SI and each preload turned into a rest value. */
export function compileSprings(compiled: Compiled, source: Document, report: Report): void {
  const doc = source as Prepared;
  const { fail, scalar, load, attempt } = reader(compiled, report);
  const springs: CompiledSpring[] = [];

  /** The force or torque in the spring at the start; a plain 0 says there is none. */
  function preload(written: Expr, dim: Dim, kind: string, path: Path): number {
    return written === 0 ? 0 : load(written, dim, kind, path);
  }

  function stiffness(written: Expr, dim: Dim, kind: string, path: Path): number {
    const value = load(written, dim, kind, path);
    if (!(value > 0)) throw fail("The stiffness must be more than zero", path);
    return value;
  }

  function point(ref: string, path: Path): BodyPoint {
    const [bodyId, name] = ref.split(".") as [string, string];
    const body = compiled.bodies.get(bodyId);
    if (!body) throw fail(`Unknown body "${bodyId}"`, path);
    const local = body.points.get(name);
    if (!local) throw fail(`Body "${bodyId}" has no point "${name}"`, path);
    return { body: body.index, u: local.u, v: local.v };
  }

  // A preload is what the spring carries where the joints close from the starting pose.
  let assembled: Float64Array | undefined;
  function start(): Float64Array {
    if (!assembled) {
      assembled = Float64Array.from(compiled.model.q0);
      // A start that cannot be assembled is reported by the run itself.
      solvePosition(compiled.model, assembled, 0);
    }
    return assembled;
  }

  for (const [id, entry] of Object.entries(doc.springs ?? {})) {
    const path = ["springs", id];
    const torsion = "joint" in entry;
    const restField = torsion ? "rest" : "length";
    attempt(() => {
      const written = torsion ? entry.rest : entry.length;
      if (written !== undefined && entry.preload !== undefined)
        throw fail(`Give either \`${restField}\` or \`preload\`, not both`, [...path, "preload"]);
      if (written === undefined && entry.preload === undefined)
        throw fail(
          torsion
            ? "A spring on a joint needs `rest`, the angle at which it pushes nothing, or `preload`, its torque at the start"
            : "A spring between two points needs `length`, the length at which it pushes nothing, or `preload`, its force at the start",
          path,
        );

      if (torsion) {
        const joint = compiled.joints.find((candidate) => candidate.id === entry.joint);
        if (!joint) throw fail(`Unknown joint "${entry.joint}"`, [...path, "joint"]);
        if (joint.type !== "revolute")
          throw fail(
            `Joint "${entry.joint}" is a ${joint.type}; a spring can only turn a revolute joint`,
            [...path, "joint"],
          );
        const [a, b] = joint.points.map((ref) => point(ref, [...path, "joint"])) as [
          BodyPoint,
          BodyPoint,
        ];
        const spring: CompiledSpring = {
          id,
          kind: "torsion",
          a: a.body,
          b: b.body,
          stiffness: stiffness(
            entry.stiffness,
            TORSIONAL_STIFFNESS,
            "The stiffness of a spring on a joint is a torque for each angle, such as 0.02 N*m/rad",
            [...path, "stiffness"],
          ),
          rest: 0,
        };
        if (entry.rest !== undefined) spring.rest = scalar(entry.rest, ANGLE, [...path, "rest"]);
        else {
          const torque = preload(
            entry.preload as Expr,
            TORQUE,
            "The preload of a spring on a joint is a torque, such as 0.5 N*m",
            [...path, "preload"],
          );
          // It turns the joint towards its rest angle, so that lies further the positive way.
          spring.rest = springValue(spring, start()) + torque / spring.stiffness;
        }
        springs.push(spring);
        return;
      }

      const a = point(entry.connect[0], [...path, "connect", 0]);
      const b = point(entry.connect[1], [...path, "connect", 1]);
      if (a.body === b.body)
        throw fail("A spring must connect two different bodies", [...path, "connect"]);
      const spring: CompiledSpring = {
        id,
        kind: "straight",
        a,
        b,
        stiffness: stiffness(
          entry.stiffness,
          LINEAR_STIFFNESS,
          "The stiffness of a spring between two points is a force for each length, such as 2 N/mm",
          [...path, "stiffness"],
        ),
        rest: 0,
      };
      if (entry.length !== undefined) {
        spring.rest = scalar(entry.length, LENGTH, [...path, "length"]);
        if (spring.rest < 0)
          throw fail("A spring's length cannot be less than zero", [...path, "length"]);
      } else {
        const tension = preload(
          entry.preload as Expr,
          FORCE,
          "The preload of a spring between two points is a force, such as 5 N",
          [...path, "preload"],
        );
        // In tension it is longer than at rest.
        spring.rest = springValue(spring, start()) - tension / spring.stiffness;
      }
      springs.push(spring);
    });
  }

  (compiled as FitCompiled).springs = springs;
}
