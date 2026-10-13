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
import type { Spring } from "./schema.ts";
import { type CompiledSpring, springValue } from "./solver/springs.ts";

type SpringEntry = z.infer<typeof Spring>;
type SpringDocument = Document & { springs?: Record<string, SpringEntry> };
type Report = (diagnostic: Diagnostic) => void;
type Path = (string | number)[];
type Expr = number | string;

/** Raised for a problem that is already recorded as a diagnostic. */
class Reported extends Error {}

/** Everything mekafit adds to the compiled model, in core's `extend` hook. */
export function compileFit(compiled: Compiled, source: Document, report: Report): void {
  compileContacts(compiled, source, report);
  compileSprings(compiled, source, report);
}

/** Read and check the springs, with every value in SI and each preload turned into a rest value. */
export function compileSprings(compiled: Compiled, source: Document, report: Report): void {
  const doc = source as SpringDocument;
  const springs: CompiledSpring[] = [];

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

  /** A length or an angle, where a plain number is in the document's unit. */
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
    try {
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
        continue;
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
    } catch (error) {
      if (!(error instanceof Reported)) throw error;
    }
  }

  (compiled as FitCompiled).springs = springs;
}
