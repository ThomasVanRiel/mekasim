import { Geometry } from "@mekasim/ui";
import { useStore } from "../store.ts";

/** The drawings the model takes outlines from: what each holds, and adding or exchanging them. */
export function Drawings() {
  const sources = useStore((s) => s.simulation.sources);
  const drawings = useStore((s) => s.simulation.drawings);
  const uses = useStore((s) => s.simulation.uses);
  const files = useStore((s) => s.files);

  return (
    <section aria-label="Drawings" className="border-rule border-t">
      <h2 className="border-rule border-b px-3 py-2 font-semibold">Drawings</h2>
      <Geometry
        sources={sources}
        drawings={drawings}
        uses={uses}
        files={files}
        onAdd={(picked) => useStore.getState().attach(picked)}
        onReplace={(file, text) => useStore.getState().replace(file, text)}
      />
    </section>
  );
}
