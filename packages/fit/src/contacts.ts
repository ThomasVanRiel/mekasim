import type { Compiled, Diagnostic, Document } from "@mekasim/core";
import type * as z from "zod";
import type { Contact } from "./schema.ts";

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
}

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
