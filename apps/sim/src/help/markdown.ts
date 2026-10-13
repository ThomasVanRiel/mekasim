/**
 * A reader for the part of Markdown the format reference is written in: headings,
 * paragraphs, bullet lists, tables and fenced code, with code, bold text and links
 * inside a line. Anything else is taken as ordinary text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; content: Inline[] }
  | { kind: "link"; href: string; content: Inline[] };

export type Block =
  | { kind: "heading"; level: number; id: string; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; text: string };

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[((?:`[^`]*`|[^\]`])+)\]\(([^)\s]+)\)/g;

/** The code, bold text and links within a run of text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    const [whole, code, strong, linked, href] = match;
    if (code !== undefined) out.push({ kind: "code", text: code });
    else if (strong !== undefined) out.push({ kind: "strong", content: parseInline(strong) });
    else out.push({ kind: "link", href: href as string, content: parseInline(linked as string) });
    last = match.index + whole.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The words of a run of text, without its markup. */
export function plain(content: Inline[]): string {
  return content.map((part) => ("text" in part ? part.text : plain(part.content))).join("");
}

/** A heading as a name that can go in an address: "Units and expressions" is `units-and-expressions`. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The cells of one row of a table. A `|` inside code does not end a cell. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inCode = false;
  for (const ch of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell.trim());
  return out;
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^[-*]\s+(.*)$/;
const DIVIDER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || line.startsWith("|");
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;
    const heading = HEADING.exec(line);

    if (line.trim() === "") {
      i++;
    } else if (FENCE.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i] as string); i++) {
        code.push(lines[i] as string);
      }
      i++;
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (heading) {
      const content = parseInline((heading[2] as string).trim());
      blocks.push({
        kind: "heading",
        level: (heading[1] as string).length,
        id: slug(plain(content)),
        content,
      });
      i++;
    } else if (line.startsWith("|") && DIVIDER.test(lines[i + 1] ?? "")) {
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && (lines[i] as string).startsWith("|"); i++) {
        rows.push(cells(lines[i] as string).map(parseInline));
      }
      blocks.push({ kind: "table", head, rows });
    } else if (ITEM.test(line)) {
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const item = ITEM.exec(lines[i] as string);
        if (item) items.push(item[1] as string);
        // A line set in under an item carries on with it.
        else if (/^\s+\S/.test(lines[i] as string))
          items.push(`${items.pop()} ${lines[i]?.trim()}`);
        else break;
      }
      blocks.push({ kind: "list", items: items.map(parseInline) });
    } else {
      const words: string[] = [line.trim()];
      for (i++; i < lines.length; i++) {
        const next = lines[i] as string;
        if (next.trim() === "" || startsBlock(next)) break;
        words.push(next.trim());
      }
      blocks.push({ kind: "paragraph", content: parseInline(words.join(" ")) });
    }
  }
  return blocks;
}
