import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { jsonSchema } from "../src/schema/document.ts";

it("has an up-to-date JSON Schema file (run `pnpm schema` to regenerate)", () => {
  const file = readFileSync(new URL("../schema/mekasim-1.schema.json", import.meta.url), "utf8");
  expect(JSON.parse(file)).toEqual(jsonSchema());
});
