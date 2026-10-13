import format from "../../../../docs/mekasim/FORMAT.md?raw";
import { type Block, parseMarkdown, plain } from "./markdown.ts";

/** Sections of the format reference that are about working outside the app. */
const SKIPPED = ["Editor support"];

/**
 * The part of a format reference that helps while writing a model in the app: its
 * sections, without the introduction above the first one and without those that
 * only apply outside the app.
 */
export function helpBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let keep = false;
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "heading" && block.level <= 2) {
      keep = block.level === 2 && !SKIPPED.includes(plain(block.content));
    }
    if (keep) blocks.push(block);
  }
  return blocks;
}

export interface Section {
  id: string;
  title: string;
}

/** The sections to list as the contents. */
export function sectionsOf(blocks: Block[]): Section[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" && block.level === 2
      ? [{ id: block.id, title: plain(block.content) }]
      : [],
  );
}

/** The format reference in `docs/mekasim/FORMAT.md`, as shown in the help panel. */
export const HELP: Block[] = helpBlocks(format);
