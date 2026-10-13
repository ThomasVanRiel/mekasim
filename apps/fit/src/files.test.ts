import { describe, expect, it } from "vitest";
import { attachAs, sortFiles } from "./files.ts";

describe("files picked to open", () => {
  it("are a model and the drawings that go with it", () => {
    const { model, drawings } = sortFiles([
      ["links.dxf", "0\nEOF"],
      ["four-bar.mekafit.yaml", "mekafit: 1"],
      ["more.DXF", "0\nEOF"],
    ]);
    expect(model).toBe("mekafit: 1");
    expect([...drawings.keys()]).toEqual(["links.dxf", "more.DXF"]);
  });

  it("can be drawings alone, to attach", () => {
    const { model, drawings } = sortFiles([["links.dxf", "0\nEOF"]]);
    expect(model).toBeUndefined();
    expect(drawings.size).toBe(1);
  });

  it("take the first model when several are picked", () => {
    expect(
      sortFiles([
        ["a.yaml", "first"],
        ["b.yml", "second"],
      ]).model,
    ).toBe("first");
  });
});

describe("drawings attached to a model", () => {
  it("go by their own names", () => {
    const picked = new Map([
      ["a.dxf", "A"],
      ["b.dxf", "B"],
    ]);
    expect([...attachAs(picked, ["a.dxf", "c.dxf"]).keys()]).toEqual(["a.dxf", "b.dxf"]);
    expect([...attachAs(new Map([["a.dxf", "A"]]), []).keys()]).toEqual(["a.dxf"]);
  });

  it("take the place of the one drawing that is missing, whatever the file is called", () => {
    const renamed = attachAs(new Map([["links (2).dxf", "A"]]), ["four-bar-links.dxf"]);
    expect([...renamed]).toEqual([["four-bar-links.dxf", "A"]]);
    // With its own name it needs no help.
    expect([
      ...attachAs(new Map([["four-bar-links.dxf", "A"]]), ["four-bar-links.dxf"]).keys(),
    ]).toEqual(["four-bar-links.dxf"]);
  });
});
