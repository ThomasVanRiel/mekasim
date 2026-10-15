import type { Files } from "@mekasim/core";

/** cyrb53: a quick 53-bit hash of a text, as hex. Not for secrets; for telling texts apart. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * What a study's results are kept under: the model text, its drawings and the study's
 * name. Results under another key are from another version of the model.
 */
export function studyKey(text: string, files: Files, study: string): string {
  const drawings = [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, content]) => `${name}\0${hash(content)}`);
  return hash([study, text, ...drawings].join("\0\0"));
}
