import { endOf, type Loop, type Point, type Segment, startOf } from "./shape.ts";

/** Something wrong with an outline, with the place where it is when there is one. */
export class OutlineError extends Error {
  /** Offset into the path text, for a problem in how it is written. */
  readonly pos?: number;
  /** The place on the outline, in the unit the outline is written in. */
  readonly at?: Point;

  constructor(message: string, where: { pos?: number; at?: Point } = {}) {
    super(message);
    this.name = "OutlineError";
    this.pos = where.pos;
    this.at = where.at;
  }
}

const TURN = 2 * Math.PI;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
/** How many numbers each command takes. */
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, A: 7, Z: 0 };

/** A number as it is written in a path or a message: no noise in the last digits. */
export function tidy(value: number): string {
  // What is left of a sine or cosine that should have been nothing is nothing.
  if (Math.abs(value) < 1e-12) return "0";
  return Number(value.toPrecision(12)).toString();
}

export function placeText([x, y]: Point): string {
  return `(${tidy(x)}, ${tidy(y)})`;
}

/**
 * The arc of a circle from one point to another, as SVG gives it: by its radius,
 * whether it goes the long way round, and which way it turns (`sweep` true for
 * anticlockwise, with y upwards).
 */
export function arcBetween(
  from: Point,
  to: Point,
  r: number,
  large: boolean,
  sweep: boolean,
  pos?: number,
): Segment {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0) {
    throw new OutlineError(
      `An arc at ${placeText(from)} ends where it starts. Write a full circle as two arcs`,
      { pos, at: from },
    );
  }
  // SVG would quietly make the circle bigger; here that means a broken drawing.
  if (chord > 2 * r * (1 + 1e-9)) {
    throw new OutlineError(
      `An arc of radius ${tidy(r)} cannot reach from ${placeText(from)} to ${placeText(to)}, which are ${tidy(chord)} apart`,
      { pos, at: from },
    );
  }
  const rise = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
  // Going anticlockwise the short way, the centre is on the left of the chord.
  const side = large !== sweep ? 1 : -1;
  const cx = (from[0] + to[0]) / 2 - (side * rise * dy) / chord;
  const cy = (from[1] + to[1]) / 2 + (side * rise * dx) / chord;
  const start = Math.atan2(from[1] - cy, from[0] - cx);
  const end = Math.atan2(to[1] - cy, to[0] - cx);
  let turned = (end - start) % TURN;
  if (sweep && turned <= 0) turned += TURN;
  if (!sweep && turned >= 0) turned -= TURN;
  return { kind: "arc", cx, cy, r, start, sweep: turned };
}

/**
 * Read path text into outlines, in the order written. The part of SVG path data
 * that real outlines need: M, L, H, V, A and Z, in capitals for places and in small
 * letters for steps from the last place. Every outline must be closed with Z.
 */
export function parsePath(text: string): Loop[] {
  const loops: Loop[] = [];
  let i = 0;
  let segments: Segment[] | undefined;
  let first: Point = [0, 0];
  let current: Point = [0, 0];
  /** Where the outline being read was started, in the text. */
  let opened = 0;

  function skip(): void {
    while (i < text.length && /[\s,]/.test(text[i] as string)) i++;
  }

  function number(command: string): number {
    skip();
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text)?.[0];
    if (match === undefined) {
      throw new OutlineError(
        i >= text.length
          ? `The path ends in the middle of "${command}"`
          : `Expected a number for "${command}" but found "${text[i]}"`,
        { pos: i },
      );
    }
    i += match.length;
    return Number(match);
  }

  /** One of the two yes-or-no figures of an arc, which may be written without a gap after it. */
  function flag(): boolean {
    skip();
    const ch = text[i];
    if (ch !== "0" && ch !== "1") {
      throw new OutlineError('Expected 0 or 1 after the radii and the turn of "A"', { pos: i });
    }
    i++;
    return ch === "1";
  }

  function close(pos: number): void {
    if (!segments) return;
    const gap = Math.hypot(current[0] - first[0], current[1] - first[1]);
    // Z draws the last straight line itself when the outline has not come back yet.
    // Back but for the last digit of a number as it was written, it has come back.
    if (gap > 1e-9 * (1 + Math.abs(first[0]) + Math.abs(first[1]))) {
      segments.push({ kind: "line", ax: current[0], ay: current[1], bx: first[0], by: first[1] });
    }
    if (segments.length === 0) {
      throw new OutlineError(`An outline at ${placeText(first)} has nothing in it`, {
        pos,
        at: first,
      });
    }
    loops.push({ segments });
    segments = undefined;
    current = first;
  }

  function unclosed(): OutlineError {
    return new OutlineError(
      `The outline that starts at ${placeText(first)} is not closed: end it with Z`,
      { pos: opened, at: first },
    );
  }

  for (;;) {
    skip();
    if (i >= text.length) break;
    const pos = i;
    const letter = text[i] as string;
    const command = letter.toUpperCase();
    if (!(command in ARITY)) {
      throw new OutlineError(
        /[A-Za-z]/.test(letter)
          ? `"${letter}" is not one of M, L, H, V, A and Z. Curves other than arcs come from a drawing, not from path text`
          : `Expected a command such as M or L but found "${letter}"`,
        { pos },
      );
    }
    i++;
    const relative = letter !== command;

    if (command === "Z") {
      if (!segments) throw new OutlineError("Z closes an outline, and none is open", { pos });
      close(pos);
      continue;
    }

    // Numbers that follow on after a command repeat it; after M they are lines.
    for (let repeat = 0; ; repeat++) {
      if (repeat > 0) {
        skip();
        NUMBER.lastIndex = i;
        if (!NUMBER.test(text)) break;
      }
      const doing = command === "M" && repeat > 0 ? "L" : command;
      if (doing === "M") {
        if (segments) throw unclosed();
        const x = number(letter);
        const y = number(letter);
        first = relative ? [current[0] + x, current[1] + y] : [x, y];
        current = first;
        segments = [];
        opened = pos;
        continue;
      }
      if (!segments) {
        throw new OutlineError(`An outline starts with M, not with "${letter}"`, { pos });
      }
      let to: Point;
      if (doing === "A") {
        const rx = number(letter);
        const ry = number(letter);
        const turn = number(letter);
        const large = flag();
        const sweep = flag();
        const x = number(letter);
        const y = number(letter);
        if (rx <= 0 || Math.abs(rx - ry) > 1e-9 * Math.abs(rx) || turn !== 0) {
          throw new OutlineError(
            `An arc is part of a circle: both radii equal and more than zero, and a turn of 0. Found ${tidy(rx)} ${tidy(ry)} ${tidy(turn)}`,
            { pos, at: current },
          );
        }
        to = relative ? [current[0] + x, current[1] + y] : [x, y];
        segments.push(arcBetween(current, to, rx, large, sweep, pos));
      } else {
        if (doing === "H") {
          const x = number(letter);
          to = [relative ? current[0] + x : x, current[1]];
        } else if (doing === "V") {
          const y = number(letter);
          to = [current[0], relative ? current[1] + y : y];
        } else {
          const x = number(letter);
          const y = number(letter);
          to = relative ? [current[0] + x, current[1] + y] : [x, y];
        }
        if (to[0] === current[0] && to[1] === current[1]) {
          throw new OutlineError(`A line at ${placeText(to)} goes nowhere`, { pos, at: to });
        }
        segments.push({ kind: "line", ax: current[0], ay: current[1], bx: to[0], by: to[1] });
      }
      current = to;
    }
  }
  if (segments) throw unclosed();
  if (loops.length === 0) throw new OutlineError("The path is empty", { pos: 0 });
  return loops;
}

function arcText(arc: Segment & { kind: "arc" }, from: number, sweep: number, to?: string): string {
  const end = from + sweep;
  const x = arc.cx + arc.r * Math.cos(end);
  const y = arc.cy + arc.r * Math.sin(end);
  const r = tidy(arc.r);
  const flags = `${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0}`;
  return `A ${r} ${r} 0 ${flags} ${to ?? `${tidy(x)} ${tidy(y)}`}`;
}

/** The most of a circle that one arc of written path text covers. */
const MOST = (2 * Math.PI) / 3;

/**
 * Outlines as path text, in capitals throughout. An arc of more than a third of a
 * circle is written as several, so a whole circle is three arcs.
 */
export function writePath(loops: Loop[]): string {
  return loops
    .map((loop) => {
      const first = loop.segments[0];
      if (!first) return "";
      const origin = startOf(first).map(tidy).join(" ");
      const parts = [`M ${origin}`];
      loop.segments.forEach((segment, i) => {
        // The last segment ends where the first began, to the digit, so the outline closes.
        const home = i === loop.segments.length - 1 ? origin : undefined;
        if (segment.kind === "line") {
          parts.push(`L ${home ?? endOf(segment).map(tidy).join(" ")}`);
        } else {
          // An arc near half a circle is poorly told by its two ends: the last digit of
          // a number moves its centre a thousand times as far. Written in pieces of no
          // more than a third of a circle, it comes back as it was.
          const pieces = Math.ceil(Math.abs(segment.sweep) / MOST - 1e-9);
          const each = segment.sweep / pieces;
          for (let k = 0; k < pieces; k++) {
            const last = k === pieces - 1 ? home : undefined;
            parts.push(arcText(segment, segment.start + k * each, each, last));
          }
        }
      });
      // The last line back to the start is what Z draws.
      const last = loop.segments.at(-1);
      if (last?.kind === "line" && loop.segments.length > 1) parts.pop();
      return `${parts.join(" ")} Z`;
    })
    .filter((text) => text !== "")
    .join(" ");
}
