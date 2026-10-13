import { describe, expect, it } from "vitest";
import { sortFiles } from "./files.ts";

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
