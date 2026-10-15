// Reading a model's drawings from disk, for the command line and the tests. Not part
// of what the apps use: a browser is handed its files.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { load } from "../schema/load.ts";
import { drawingFiles, type Files } from "./resolve.ts";

/**
 * The drawings a model names, read from beside the model: each file name is taken
 * from the folder the model is in. A file that is not there is left out, and the
 * model then says that it is not attached. `schema` reads a format built on mekasim's.
 */
export function drawingsBeside(
  modelPath: string,
  text: string,
  schema?: Parameters<typeof load>[1],
): Files {
  const files = new Map<string, string>();
  for (const name of drawingFiles(text, schema)) {
    const path = resolve(dirname(modelPath), name);
    if (existsSync(path)) files.set(name, readFileSync(path, "utf8"));
  }
  return files;
}
