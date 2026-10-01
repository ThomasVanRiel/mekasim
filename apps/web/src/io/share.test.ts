import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeModel, encodeModel, exampleFragment, exampleIn } from "./share.ts";

const shaker = readFileSync(
  new URL("../../../../examples/shaker.mekasim.yaml", import.meta.url),
  "utf8",
);

describe("share links", () => {
  it("carries a model through a link unchanged, comments and all", async () => {
    const fragment = await encodeModel(shaker);
    expect(await decodeModel(fragment)).toBe(shaker);
  });

  it("uses only characters that are safe in a link, and is shorter than the text", async () => {
    const fragment = await encodeModel(shaker);
    expect(fragment).toMatch(/^#m=[A-Za-z0-9_-]+$/);
    expect(fragment.length).toBeLessThan(shaker.length);
  });

  it("keeps text beyond plain ASCII", async () => {
    const text = "# 28 mm/s², größe, 軸\nmekasim: 1\n";
    expect(await decodeModel(await encodeModel(text))).toBe(text);
  });

  it("ignores other fragments and damaged links", async () => {
    expect(await decodeModel("")).toBeUndefined();
    expect(await decodeModel("#section")).toBeUndefined();
    expect(await decodeModel("#m=not-a-model")).toBeUndefined();
  });
});

describe("example links", () => {
  it("name an example in the link", () => {
    expect(exampleFragment("walschaerts")).toBe("#example=walschaerts");
    expect(exampleIn("#example=walschaerts")).toBe("walschaerts");
    expect(exampleIn(exampleFragment("geared-five-bar"))).toBe("geared-five-bar");
  });

  it("are told apart from packed models and other fragments", async () => {
    expect(exampleIn("")).toBeUndefined();
    expect(exampleIn("#example=")).toBeUndefined();
    expect(exampleIn("#m=abc")).toBeUndefined();
    expect(await decodeModel("#example=walschaerts")).toBeUndefined();
  });
});
