import { drawingFiles } from "@mekasim/core";

const files = import.meta.glob<string>(
  ["../../../examples/*.mekasim.yaml", "../../../examples/spatial/*.mekasim.yaml"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

/** The drawings some examples take their shapes from, kept beside them. */
const drawings = import.meta.glob<string>("../../../examples/*.dxf", {
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
  /** The drawings the example names, by their file names. */
  files: Map<string, string>;
}

export const EXAMPLES: Example[] = Object.entries(files).map(([path, text]) => {
  const id = (path.split("/").pop() as string).replace(".mekasim.yaml", "");
  const name = /^\s*name:\s*(.+)$/m.exec(text)?.[1] ?? id;
  const named = drawingFiles(text).flatMap((file): [string, string][] => {
    const drawing = drawingText.get(file);
    return drawing === undefined ? [] : [[file, drawing]];
  });
  return { id, name, text, files: new Map(named) };
});

export const DEFAULT_EXAMPLE = EXAMPLES.find((e) => e.id === "shaker") ?? (EXAMPLES[0] as Example);
