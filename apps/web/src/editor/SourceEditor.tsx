import { entityAt } from "@mekasim/core";
import { SourceEditor as Editor } from "@mekasim/ui";
import { editorBridge, useStore } from "../store.ts";

/** The shared source editor on mekasim's store: its text, messages and the place to show. */
export function SourceEditor() {
  const text = useStore((s) => s.text);
  const diagnostics = useStore((s) => s.simulation.diagnostics);
  const reveal = useStore((s) => s.reveal);
  return (
    <Editor
      text={text}
      diagnostics={diagnostics}
      reveal={reveal}
      onEdit={(next) => useStore.getState().edit(next)}
      // Show in the drawing what the cursor is on, for as long as the source has the keyboard.
      onCursor={(at) => useStore.getState().setFocus(at && entityAt(at.text, at.offset))}
      syncEvent={() => useStore.getState().syncEvent}
      onReady={(handle) => {
        editorBridge.text = handle?.text;
        editorBridge.undo = handle?.undo;
        editorBridge.redo = handle?.redo;
      }}
    />
  );
}
