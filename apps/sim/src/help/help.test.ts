import { readFileSync } from "node:fs";
import { jsonSchema } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { type Block, type Inline, parseInline, parseMarkdown, plain, slug } from "./markdown.ts";
import { helpBlocks, sectionsOf } from "./reference.ts";

const FORMAT = readFileSync(new URL("../../../../docs/mekasim/FORMAT.md", import.meta.url), "utf8");

describe("reading Markdown", () => {
  it("finds code, bold text and links within a line", () => {
    expect(parseInline("**Units** follow `40 mm`, see [`examples/`](../examples).")).toEqual([
      { kind: "strong", content: [{ kind: "text", text: "Units" }] },
      { kind: "text", text: " follow " },
      { kind: "code", text: "40 mm" },
      { kind: "text", text: ", see " },
      { kind: "link", href: "../examples", content: [{ kind: "code", text: "examples/" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves markup inside code alone", () => {
    expect(parseInline("write `+ - * / ^` or `**`")).toEqual([
      { kind: "text", text: "write " },
      { kind: "code", text: "+ - * / ^" },
      { kind: "text", text: " or " },
      { kind: "code", text: "**" },
    ]);
  });

  it("names a heading so that it can be jumped to", () => {
    expect(slug("Units and expressions")).toBe("units-and-expressions");
    expect(parseMarkdown("### Two ways to describe a `mechanism`")).toEqual([
      {
        kind: "heading",
        level: 3,
        id: "two-ways-to-describe-a-mechanism",
        content: [
          { kind: "text", text: "Two ways to describe a " },
          { kind: "code", text: "mechanism" },
        ],
      },
    ]);
  });

  it("joins the lines of a paragraph and of a list item", () => {
    const blocks = parseMarkdown("One\ntwo.\n\n- first\n  more\n- second\n\nAfter.");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "paragraph"]);
    expect(plain((blocks[0] as { content: Inline[] }).content)).toBe("One two.");
    expect((blocks[1] as { items: Inline[][] }).items.map(plain)).toEqual(["first more", "second"]);
  });

  it("keeps code as written, blank lines and all", () => {
    expect(
      parseMarkdown("```yaml\na: 1\n\n# not a heading\n| not | a table |\n```\nAfter."),
    ).toEqual([
      { kind: "code", text: "a: 1\n\n# not a heading\n| not | a table |" },
      { kind: "paragraph", content: [{ kind: "text", text: "After." }] },
    ]);
  });

  it("reads a table, with a | inside code kept in its cell", () => {
    const [table] = parseMarkdown("| Type | Effect |\n|---|---|\n| `a | b` | Either |\n");
    expect(table).toEqual({
      kind: "table",
      head: [[{ kind: "text", text: "Type" }], [{ kind: "text", text: "Effect" }]],
      rows: [[[{ kind: "code", text: "a | b" }], [{ kind: "text", text: "Either" }]]],
    });
  });
});

function inlines(block: Block): Inline[] {
  if (block.kind === "heading" || block.kind === "paragraph") return block.content;
  if (block.kind === "list") return block.items.flat();
  if (block.kind === "table") return [...block.head, ...block.rows.flat()].flat();
  return [];
}

function codeIn(content: Inline[]): string[] {
  return content.flatMap((part) =>
    part.kind === "code" ? [part.text] : part.kind === "text" ? [] : codeIn(part.content),
  );
}

/** Every key and every fixed word the format knows, as listed in its schema. */
function keywords(schema: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) keywords(item, found);
  } else if (typeof schema === "object" && schema !== null) {
    for (const [key, value] of Object.entries(schema)) {
      if (key === "properties") for (const name of Object.keys(value as object)) found.add(name);
      if (key === "enum") for (const word of value as unknown[]) found.add(String(word));
      if (key === "const" && typeof value === "string") found.add(value);
      keywords(value, found);
    }
  }
  return found;
}

describe("the help panel", () => {
  const help = helpBlocks(FORMAT);

  it("shows the sections that matter while writing a model", () => {
    const titles = sectionsOf(help).map((s) => s.title);
    expect(titles[0]).toBe("Overview");
    expect(titles).toContain("Joints");
    expect(titles).toContain("Measures");
    expect(titles).not.toContain("Editor support");
    expect(help.some((b) => b.kind === "code" && b.text.includes("pnpm solve"))).toBe(false);
  });

  it("gives every section a name of its own to jump to", () => {
    const ids = help.flatMap((b) => (b.kind === "heading" ? [b.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads all of the format reference, leaving no markup behind", () => {
    for (const block of help) {
      const text = plain(inlines(block));
      expect(text).not.toMatch(/^\s*\||```|\*\*|\]\(/);
      if (block.kind === "table") {
        for (const row of block.rows) expect(row).toHaveLength(block.head.length);
      }
    }
  });

  it("mentions every keyword of the format", () => {
    const written = help.flatMap((b) => (b.kind === "code" ? [b.text] : codeIn(inlines(b))));
    const missing = [...keywords(jsonSchema())].filter(
      (word) => !written.some((code) => new RegExp(`(^|[^\\w-])${word}($|[^\\w-])`).test(code)),
    );
    expect(missing).toEqual([]);
  });
});
