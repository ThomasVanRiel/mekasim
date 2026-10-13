const files = import.meta.glob<string>("../../../examples/*.mekasim.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface Example {
  id: string;
  name: string;
  text: string;
}

export const EXAMPLES: Example[] = Object.entries(files).map(([path, text]) => {
  const id = (path.split("/").pop() as string).replace(".mekasim.yaml", "");
  const name = /^\s*name:\s*(.+)$/m.exec(text)?.[1] ?? id;
  return { id, name, text };
});

export const DEFAULT_EXAMPLE = EXAMPLES.find((e) => e.id === "shaker") ?? (EXAMPLES[0] as Example);
