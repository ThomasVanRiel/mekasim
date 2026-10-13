import {
  type Compiled,
  type Diagnostic,
  type Document,
  formatQuantity,
  type Gap,
  gapsOf,
  LENGTH,
  type MeasuredGap,
  type Simulation,
} from "@mekasim/core";
import type * as z from "zod";
import type { Contact } from "./schema.ts";
import type { Jam } from "./solver/quasistatic.ts";
import type { CompiledSpring } from "./solver/springs.ts";
import type { CompiledMove } from "./solver/stages.ts";

type ContactEntry = z.infer<typeof Contact>;
type ContactDocument = Document & { contacts?: Record<string, ContactEntry> };
type Report = (diagnostic: Diagnostic) => void;

/** One distinct pair produced by a named `contacts:` entry. */
export interface CompiledContact {
  id: string;
  a: string;
  b: string;
  /** The entry responsible for this pair, used for results and messages. */
  path: ["contacts", string];
}

/** The part of mekafit's compiled model added in core's `extend` hook. */
export interface FitCompiled extends Compiled {
  contacts: CompiledContact[];
  springs: CompiledSpring[];
  moves: CompiledMove[];
}

/** What a listed pair did over one run, including where it came closest. */
export interface ContactResult extends CompiledContact {
  measured: MeasuredGap;
  smallest: Gap;
  step: number;
}

/** A pair proposed by Find contacts. */
export interface ContactCandidate {
  a: string;
  b: string;
  measured: MeasuredGap;
  smallest: Gap;
  step: number;
  listed: boolean;
}

/** A core simulation with mekafit's contact results beside it. */
export interface FitSimulation extends Simulation {
  compiled?: FitCompiled;
  contacts: ContactResult[];
  /** Where a contact run stopped because the parts could not be put anywhere. */
  jam?: Jam;
}

/** Overlaps no deeper than one thousandth of a millimetre are drawing noise. */
export const OVERLAP_TOLERANCE = 0.000001;

/** Expand the named contact sets into distinct pairs and check that every body has a shape. */
export function compileContacts(compiled: Compiled, source: Document, report: Report): void {
  const doc = source as ContactDocument;
  const contacts: CompiledContact[] = [];
  const seen = new Set<string>();

  for (const [id, entry] of Object.entries(doc.contacts ?? {})) {
    const field = "between" in entry ? "between" : "among";
    const names: readonly string[] = "between" in entry ? entry.between : entry.among;
    const valid = new Set<string>();
    names.forEach((name, index) => {
      const body = compiled.bodies.get(name);
      const path = ["contacts", id, field, index] as (string | number)[];
      if (!body) report({ severity: "error", message: `Unknown body "${name}"`, path });
      else if (!body.shape)
        report({
          severity: "error",
          message: `"${name}" has no shape, so it cannot be named in contacts`,
          path,
        });
      else valid.add(name);
    });

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i] as string;
        const b = names[j] as string;
        if (a === b || !valid.has(a) || !valid.has(b)) continue;
        const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        contacts.push({ id, a, b, path: ["contacts", id] });
      }
    }
  }

  (compiled as FitCompiled).contacts = contacts;
}

/** Measure every listed pair over a completed run and keep its closest step and places. */
export function contactResults(simulation: Simulation): ContactResult[] {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle) return [];
  const contacts = (compiled as FitCompiled).contacts ?? [];
  const results: ContactResult[] = [];

  for (const contact of contacts) {
    const measured = gapsOf(compiled, cycle, contact.a, contact.b, contact.path);
    if (!measured || measured.gaps.length === 0) continue;
    let step = 0;
    for (let k = 1; k < measured.gaps.length; k++) {
      if ((measured.gaps[k]?.distance as number) < (measured.gaps[step]?.distance as number)) {
        step = k;
      }
    }
    results.push({ ...contact, measured, smallest: measured.gaps[step] as Gap, step });
  }
  return results;
}

/** Every shaped pair that comes within `distance` over the run, plus already listed pairs. */
export function findContacts(simulation: Simulation, distance: number): ContactCandidate[] {
  const { compiled, cycle } = simulation;
  if (!compiled || !cycle || distance < 0) return [];
  const listed = (compiled as FitCompiled).contacts ?? [];
  const listedKeys = new Set(listed.map(({ a, b }) => pairKey(a, b)));
  const bodies = [...compiled.bodies.values()].filter((body) => body.shape);
  const found: ContactCandidate[] = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]?.id as string;
      const b = bodies[j]?.id as string;
      const measured = gapsOf(compiled, cycle, a, b);
      if (!measured?.gaps.length) continue;
      let step = 0;
      for (let k = 1; k < measured.gaps.length; k++) {
        if ((measured.gaps[k]?.distance as number) < (measured.gaps[step]?.distance as number)) {
          step = k;
        }
      }
      const smallest = measured.gaps[step] as Gap;
      const isListed = listedKeys.has(pairKey(a, b));
      if (isListed || smallest.distance <= distance) {
        found.push({ a, b, measured, smallest, step, listed: isListed });
      }
    }
  }
  return found;
}

/** An unordered body's pair as one stable key. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** Messages found by checking the measured contact pairs. */
export function contactDiagnostics(
  simulation: Simulation,
  results = contactResults(simulation),
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { compiled } = simulation;
  if (!compiled) return diagnostics;

  for (const contact of results) {
    const found = contact.measured;
    if (found.pinned && found.over > 0) {
      diagnostics.push({
        severity: "warning",
        message: `"${found.a}" and "${found.b}" are joined by a pin, so where they lie over each other is not counted, and gap() gives 0 there. To measure the gap between them, draw them clear of each other round the pin`,
        path: contact.path,
      });
      continue;
    }
    const step = found.gaps.findIndex((gap) => gap.distance < -OVERLAP_TOLERANCE);
    if (step < 0) continue;
    const depth = formatQuantity(
      -(found.gaps[step]?.distance as number),
      LENGTH,
      compiled.units,
      4,
    );
    diagnostics.push({
      severity: "error",
      message: `"${found.a}" runs into "${found.b}" at step ${step}, ${depth} deep`,
      path: contact.path,
    });
  }
  return diagnostics;
}
