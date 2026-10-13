import { drawingFiles } from "@mekasim/core";

const models = import.meta.glob<string>("../../../examples/fit/*.mekafit.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Drawings kept beside mekafit's own examples. */
const drawings = import.meta.glob<string>("../../../examples/fit/*.dxf", {
  query: "?raw",
  import: "default",
  eager: true,
});

const drawingText = new Map(
  Object.entries(drawings).map(([path, text]) => [path.split("/").pop() as string, text]),
);

export interface Example {
  id: string;
  name: string;
  text: string;
  files: Map<string, string>;
}

/** Built-in mekafit examples, separate from mekasim's examples. */
export const EXAMPLES: Example[] = Object.entries(models).map(([path, text]) => {
  const id = (path.split("/").pop() as string).replace(".mekafit.yaml", "");
  const name = /^\s*name:\s*(.+)$/m.exec(text)?.[1] ?? id;
  const named = drawingFiles(text).flatMap((file): [string, string][] => {
    const drawing = drawingText.get(file);
    return drawing === undefined ? [] : [[file, drawing]];
  });
  return { id, name, text, files: new Map(named) };
});

export const DEFAULT_EXAMPLE =
  EXAMPLES.find(({ id }) => id === "clearance-check") ?? (EXAMPLES[0] as Example);
