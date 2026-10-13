import { readdirSync, readFileSync } from "node:fs";
import { simulate as simulateModel } from "@mekasim/core";
import { describe, expect, it } from "vitest";
import { asMekasim, load, simulate, sweep } from "../src/index.ts";

const EXAMPLES = new URL("../../../examples/", import.meta.url);
const files = readdirSync(EXAMPLES).filter((file) => file.endsWith(".mekasim.yaml"));
const read = (file: string): string => readFileSync(new URL(file, EXAMPLES), "utf8");
const fourBar = read("four-bar.mekasim.yaml");
const fit = fourBar.replace("mekasim: 1", "mekafit: 1");

describe("a mekasim model in mekafit", () => {
  it("has every example to try", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    it(`solves ${file} to mekasim's numbers`, () => {
      const here = simulate(read(file));
      const there = simulateModel(read(file));
      expect(here.diagnostics).toEqual(there.diagnostics);
      expect(here.cycle?.count).toBe(there.cycle?.count);
      expect(here.cycle?.q).toEqual(there.cycle?.q);
      expect(here.measures).toEqual(there.measures);
      expect(here.checks).toEqual(there.checks);
      expect(here.plots).toEqual(there.plots);
    });
  }
});

describe("a mekafit model", () => {
  it("starts with its own first line, and is then mekasim's format", () => {
    expect(load(fit).diagnostics).toEqual([]);
    expect(simulate(fit).cycle?.q).toEqual(simulateModel(fourBar).cycle?.q);
  });

  it("does not open in mekasim", () => {
    expect(simulateModel(fit).diagnostics.length).toBeGreaterThan(0);
  });

  it("needs one first line", () => {
    expect(load(fit.replace("mekafit: 1\n", "")).diagnostics[0]?.message).toBe(
      'A model starts with "mekafit: 1" or "mekasim: 1"',
    );
  });

  it("is varied over a parameter as a mekasim model is", () => {
    const runs = sweep(fit, "r", [30, 40], "mm");
    expect(runs.map((run) => run.simulation.diagnostics)).toEqual([[], []]);
    expect(runs[0]?.simulation.cycle?.q).not.toEqual(runs[1]?.simulation.cycle?.q);
  });
});

describe("going back to mekasim", () => {
  it("gives a mekasim model as it is", () => {
    expect(asMekasim(fourBar)).toBe(fourBar);
  });

  it("changes only the first line of a mekafit model that adds nothing", () => {
    expect(asMekasim(fit)).toBe(fourBar);
  });

  it("gives nothing for a model that does not read", () => {
    expect(asMekasim("mekafit: 1\nbodies: [")).toBeUndefined();
    expect(asMekasim(fit.replace("bodies:", "shapes:"))).toBeUndefined();
  });
});
