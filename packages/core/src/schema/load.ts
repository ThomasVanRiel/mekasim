import { isNode, LineCounter, parseDocument, type Document as YamlDocument } from "yaml";
import type { Diagnostic, Position } from "../diagnostics.ts";
import { Document } from "./document.ts";

export interface Loaded {
  /** Present when the text is a valid document. */
  doc?: Document;
  diagnostics: Diagnostic[];
  /** Line and column of a document path, for diagnostics raised later. */
  locate(path: (string | number)[]): Position | undefined;
}

function locator(yaml: YamlDocument, lines: LineCounter): Loaded["locate"] {
  return (path) => {
    // A missing key has no node of its own, so fall back to the nearest parent.
    for (let depth = path.length; depth >= 0; depth--) {
      const node = depth === 0 ? yaml.contents : yaml.getIn(path.slice(0, depth), true);
      if (isNode(node) && node.range) return lines.linePos(node.range[0]);
    }
    return undefined;
  };
}

/** Parse and validate model text. YAML 1.2, so JSON is accepted as well. */
export function load(text: string): Loaded {
  const lines = new LineCounter();
  const yaml = parseDocument(text, { lineCounter: lines });
  const locate = locator(yaml, lines);

  if (yaml.errors.length > 0) {
    const diagnostics = yaml.errors.map((error): Diagnostic => {
      const position = error.linePos?.[0];
      return {
        severity: "error",
        // The library appends a source excerpt after the first line.
        message: error.message.split("\n")[0] as string,
        position: position && { line: position.line, col: position.col },
      };
    });
    return { diagnostics, locate };
  }

  const parsed = Document.safeParse(yaml.toJS());
  if (parsed.success) return { doc: parsed.data, diagnostics: [], locate };

  const diagnostics = parsed.error.issues.map((issue): Diagnostic => {
    const path = issue.path.filter((key) => typeof key !== "symbol");
    return { severity: "error", message: issue.message, path, position: locate(path) };
  });
  return { diagnostics, locate };
}
