import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { jsonSchema } from "../src/schema/document.ts";

it("has an up-to-date JSON Schema file, byte for byte (run `pnpm schema` to regenerate)", () => {
  const file = readFileSync(new URL("../schema/mekasim-1.schema.json", import.meta.url), "utf8");
  // Written as `scripts/write-schema.ts` writes it, so that the order of keys counts too.
  expect(`${JSON.stringify(jsonSchema(), null, 2)}\n`).toBe(file);
});
