import format from "../../../../docs/FORMAT.md?raw";
import guide from "../../../../skill/SKILL.md?raw";
import { EXAMPLES } from "../examples.ts";

/** Sections of the format reference that are about working in the repository, not in the app. */
const SKIPPED = ["Editor support"];

/** Examples handed to the assistant, one for each way of writing a model. */
const SHOWN = [
  "four-bar",
  "slider-crank",
  "shaker-components",
  "quick-return",
  "geared-five-bar",
  "cam-follower",
  "klann",
];

/**
 * The sections of a format reference, each heading one level down so that they sit
 * under a heading of the skill. The introduction above the first section and the
 * sections that only apply in the repository are left out.
 */
export function referenceSections(markdown: string): string {
  const lines: string[] = [];
  let keep = false;
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,2}) (.*)$/.exec(line);
    if (heading) keep = heading[1] === "##" && !SKIPPED.includes(heading[2] as string);
    if (!keep) continue;
    lines.push(!fenced && /^#+ /.test(line) ? `#${line}` : line);
  }
  return lines.join("\n").trim();
}

/** A model as it is pasted into the app: without the line that points an editor at the schema. */
function pasted(text: string): string {
  return text.replace(/^# yaml-language-server:.*\n/, "").trim();
}

/**
 * The skill as one text that stands on its own: the guide written for the
 * assistant, then the format reference, then examples to write after.
 */
export function composeSkill(
  guide: string,
  format: string,
  examples: { name: string; text: string }[],
): string {
  const models = examples.map(
    (example) => `### ${example.name}\n\n\`\`\`yaml\n${pasted(example.text)}\n\`\`\``,
  );
  return [
    guide.trim(),
    `## Format reference\n\n${referenceSections(format)}`,
    `## Examples\n\nComplete models that run as they are.\n\n${models.join("\n\n")}`,
    "",
  ].join("\n\n");
}

/** The skill handed out by the app: `skill/SKILL.md` with the format reference and examples. */
export const SKILL: string = composeSkill(
  guide,
  format,
  SHOWN.flatMap((id) => EXAMPLES.filter((example) => example.id === id)),
);

/** The name under which the skill is saved; assistants look for a skill under this name. */
export const SKILL_FILE = "SKILL.md";
