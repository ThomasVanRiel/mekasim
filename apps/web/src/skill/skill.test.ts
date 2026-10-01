import { readFileSync } from "node:fs";
import { simulate } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { composeSkill, referenceSections, SKILL } from "./skill.ts";

const GUIDE = readFileSync(new URL("../../../../skill/SKILL.md", import.meta.url), "utf8");

/** The models written out in a text, each a fenced block that starts a file. */
function models(markdown: string): string[] {
  return [...markdown.matchAll(/```yaml\n([\s\S]*?)\n```/g)]
    .map((match) => match[1] as string)
    .filter((text) => /^mekasim: 1\b/m.test(text));
}

describe("the format reference in the skill", () => {
  const reference = referenceSections(
    [
      "# Title",
      "Introduction.",
      "## Overview",
      "```yaml",
      "## not a heading",
      "# a comment",
      "```",
      "### Details",
      "Text.",
      "## Editor support",
      "Only in the repository.",
      "## Messages",
      "Last.",
    ].join("\n"),
  );

  it("moves every heading one level down and leaves code as written", () => {
    expect(reference.split("\n")).toEqual([
      "### Overview",
      "```yaml",
      "## not a heading",
      "# a comment",
      "```",
      "#### Details",
      "Text.",
      "### Messages",
      "Last.",
    ]);
  });
});

describe("the skill", () => {
  it("starts with the name and description an assistant picks a skill by", () => {
    expect(SKILL).toMatch(/^---\nname: mekasim\ndescription: .{80,}\n---\n/);
  });

  it("stands on its own: the guide, the whole format and examples", () => {
    expect(SKILL).toContain("## How to build a model");
    expect(SKILL).toContain("## Format reference");
    for (const section of ["Overview", "Joints", "Components", "Measures", "Messages"]) {
      expect(SKILL).toContain(`\n### ${section}\n`);
    }
    expect(SKILL).not.toContain("pnpm");
    expect(SKILL).not.toContain("yaml-language-server");
    expect(models(SKILL).length).toBeGreaterThanOrEqual(8);
  });

  it("only shows models that run through a whole cycle without a message", () => {
    for (const text of models(SKILL)) {
      const simulation = simulate(text);
      expect(simulation.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(simulation.cycle?.count).toBe(simulation.cycle?.steps);
      expect(simulation.cycle?.count).toBeGreaterThan(1);
    }
  });

  it("teaches by an example that runs as it says", () => {
    const [worked] = models(GUIDE);
    const simulation = simulate(worked as string);
    expect(simulation.diagnostics).toEqual([]);
    expect(simulation.cycle?.count).toBe(360);
    expect(simulation.mobility).toMatchObject({ mobility: 1, free: 0, redundant: 0 });
  });

  it("lists each example under its name", () => {
    const text = composeSkill("Guide.", "## Overview\nText.", [
      { name: "Four-bar", text: "# yaml-language-server: $schema=x\nmekasim: 1\n" },
    ]);
    expect(text).toBe(
      "Guide.\n\n## Format reference\n\n### Overview\nText.\n\n## Examples\n\nComplete models that run as they are.\n\n### Four-bar\n\n```yaml\nmekasim: 1\n```\n\n",
    );
  });
});
