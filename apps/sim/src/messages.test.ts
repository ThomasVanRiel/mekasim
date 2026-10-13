import { describe, expect, it } from "vitest";
import { messagesText, messageText } from "./messages.ts";

describe("a message as text", () => {
  it("says its kind, its line and what is wrong", () => {
    expect(
      messageText({
        severity: "error",
        message: 'Body "rod" has no point "C"',
        position: { line: 12, col: 5 },
      }),
    ).toBe('Error, line 12: Body "rod" has no point "C"');
  });

  it("leaves the line out of a message about the model as a whole", () => {
    expect(messageText({ severity: "info", message: "2 redundant constraints" })).toBe(
      "Note: 2 redundant constraints",
    );
  });

  it("puts several messages one to a line", () => {
    expect(
      messagesText([
        { severity: "warning", message: "First", position: { line: 3, col: 1 } },
        { severity: "error", message: "Second" },
      ]),
    ).toBe("Warning, line 3: First\nError: Second");
  });
});
