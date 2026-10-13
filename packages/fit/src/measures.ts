import { ExprError, type FunctionCall, NONE, type Node, type Quantity } from "@mekasim/core";
import type { FitCompiled } from "./contacts.ts";
import { FORCE, TORQUE } from "./registry.ts";
import type { FitCycle } from "./solver/quasistatic.ts";

/** The name a function is asked about: `force(push)` takes a name, not a value. */
function named(call: FunctionCall, what: string): string {
  const [arg] = call.args;
  const name = (call.node as Node & { kind: "call" }).name;
  if (call.args.length !== 1 || arg?.kind !== "ref")
    throw new ExprError(`${name}() takes the name of ${what}`, call.node.pos);
  return arg.name;
}

/** One value per sample; nothing where the contact step did not run, in which no force is found. */
function signal(call: FunctionCall, values: Float64Array | undefined): Float64Array {
  return values ?? new Float64Array(call.cycle.count);
}

/**
 * What a name stands for among the things that carry a force. Contacts, springs
 * and drivers are named apart, so one name may be two of them.
 */
function carrier(call: FunctionCall, name: string) {
  const compiled = call.compiled as FitCompiled;
  const { loads } = call.cycle as FitCycle;
  const spring = compiled.springs.find(({ id }) => id === name);
  const move = compiled.moves.find(({ id }) => id === name);
  const motor = compiled.drivers.find(({ id }) => id === name);
  const found = [
    compiled.contacts.some(({ id }) => id === name) && "a contact",
    spring && "a spring",
    (move || motor) && "a driver",
  ].filter((kind) => kind !== false && kind !== undefined);
  if (found.length > 1)
    throw new ExprError(
      `"${name}" is ${found.join(" and ")}; give them different names to ask about one`,
      call.node.pos,
    );
  return { loads, spring, move, motor, contact: found[0] === "a contact" };
}

/** `force(name)`: what presses a contact's parts together, a straight spring's tension, or the force of a move. */
function force(call: FunctionCall): Quantity {
  const name = named(call, "a contact, a spring or a driver");
  const { loads, spring, move, motor, contact } = carrier(call, name);
  if (contact) return { value: signal(call, loads?.contacts[name]), dim: FORCE };
  if (spring?.kind === "straight") return { value: signal(call, loads?.springs[name]), dim: FORCE };
  if (move) {
    const on = loads?.drivers[name];
    const count = call.cycle.count;
    return {
      value: Float64Array.from({ length: count }, (_, k) =>
        Math.hypot(on?.x[k] ?? 0, on?.y[k] ?? 0),
      ),
      dim: FORCE,
    };
  }
  if (spring || motor)
    throw new ExprError(
      `"${name}" turns a joint, so it has a torque: torque(${name})`,
      call.node.pos,
    );
  throw new ExprError(`Unknown contact, spring or driver "${name}"`, call.node.pos);
}

/** `torque(name)`: of a spring on a joint, the positive way round; or what a driver turns its body with. */
function torque(call: FunctionCall): Quantity {
  const name = named(call, "a spring on a joint or a driver");
  const { loads, spring, move, motor, contact } = carrier(call, name);
  if (spring?.kind === "torsion") return { value: signal(call, loads?.springs[name]), dim: TORQUE };
  if (move || motor) return { value: signal(call, loads?.drivers[name]?.torque), dim: TORQUE };
  if (spring || contact)
    throw new ExprError(
      `"${name}" pushes or pulls in a line, so it has a force: force(${name})`,
      call.node.pos,
    );
  throw new ExprError(`Unknown spring or driver "${name}"`, call.node.pos);
}

/** `latched(lock)`: 1 while the lock is in, 0 while it is out. */
function latched(call: FunctionCall): Quantity {
  const name = named(call, "a lock");
  const lock = (call.compiled as FitCompiled).locks.find(({ id }) => id === name);
  if (!lock) throw new ExprError(`Unknown lock "${name}"`, call.node.pos);
  return { value: signal(call, (call.cycle as FitCycle).latched?.[name]), dim: NONE };
}

/** `final(e)` and `first(e)`: the value at the last and at the first sample. */
function sampleAt(last: boolean): (call: FunctionCall) => Quantity {
  return (call) => {
    const name = (call.node as Node & { kind: "call" }).name;
    if (call.args.length !== 1)
      throw new ExprError(`${name}() takes 1 argument, got ${call.args.length}`, call.node.pos);
    const { value, dim } = call.evaluate(call.args[0] as Node);
    if (typeof value === "number") return { value, dim };
    return { value: (last ? value[value.length - 1] : value[0]) ?? 0, dim };
  };
}

/** The functions mekafit adds to measures, checks and plots. */
export const FIT_FUNCTIONS = {
  force,
  torque,
  latched,
  final: sampleAt(true),
  first: sampleAt(false),
};
