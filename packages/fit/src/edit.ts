import { type Document, type Edit, freeName } from "@mekasim/core";
import type * as z from "zod";
import { pairKey } from "./contacts.ts";
import { type Contact, FORMAT, FORMAT_VERSION } from "./schema.ts";

type ContactEntry = z.infer<typeof Contact>;
type ContactDocument = Document & { contacts?: Record<string, ContactEntry> };

/** Give a mekasim model mekafit's first line before writing a mekafit-only section. */
export function asFitText(text: string): string {
  return text.replace(/^mekasim(\s*:\s*)1\b/m, `${FORMAT}$1${FORMAT_VERSION}`);
}

/** Whether two bodies are already paired by a `between` entry or an expanded `among` entry. */
export function hasContact(source: Document, a: string, b: string): boolean {
  const doc = source as ContactDocument;
  return Object.values(doc.contacts ?? {}).some((entry) => {
    const names = "between" in entry ? entry.between : entry.among;
    return a !== b && names.includes(a) && names.includes(b);
  });
}

/** Edits that add each new pair as a plainly named `between:` contact. */
export function addContacts(source: Document, pairs: [string, string][]): Edit[] {
  const doc = source as ContactDocument;
  const taken = new Set(Object.keys(doc.contacts ?? {}));
  const paired = new Set<string>();
  for (const entry of Object.values(doc.contacts ?? {})) {
    const names = "between" in entry ? entry.between : entry.among;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        if (names[i] !== names[j]) paired.add(pairKey(names[i] as string, names[j] as string));
      }
    }
  }
  const edits: Edit[] = [];
  for (const [a, b] of pairs) {
    const pair = pairKey(a, b);
    if (a === b || paired.has(pair)) continue;
    const id = freeName(taken, "contact");
    taken.add(id);
    paired.add(pair);
    edits.push({ op: "set", path: ["contacts", id], value: { between: [a, b] } });
  }
  return edits;
}
