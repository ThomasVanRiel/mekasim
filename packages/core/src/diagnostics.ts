export type Severity = "error" | "warning" | "info";

/** Location in the source text, 1-based. */
export interface Position {
  line: number;
  col: number;
}

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Path into the document, e.g. `["joints", "pin_a", "connect", 0]`. */
  path?: (string | number)[];
  position?: Position;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
