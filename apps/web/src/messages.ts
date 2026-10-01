import type { Diagnostic, Severity } from "@mekasim/core";

/** What each kind of message is called in the list. */
export const KIND: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Note",
};

/** A message as text to paste elsewhere: its kind, where it is in the source, and what it says. */
export function messageText(diagnostic: Diagnostic): string {
  const { severity, message, position } = diagnostic;
  const where = position ? `, line ${position.line}` : "";
  return `${KIND[severity]}${where}: ${message}`;
}

/** All the messages as text, one to a line, in the order of the list. */
export function messagesText(diagnostics: Diagnostic[]): string {
  return diagnostics.map(messageText).join("\n");
}
