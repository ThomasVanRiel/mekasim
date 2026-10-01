// Writes the JSON Schema of the document format, for editor validation and autocomplete.
import { writeFileSync } from "node:fs";
import { jsonSchema } from "../src/schema/document.ts";

const target = new URL("../schema/mekasim-1.schema.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(jsonSchema(), null, 2)}\n`);
console.log(`Wrote ${target.pathname}`);
