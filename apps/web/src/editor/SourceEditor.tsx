import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic as EditorDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";

/** How long to wait after the last keystroke before solving again. */
const SOLVE_DELAY_MS = 200;

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--color-sheet)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--color-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-sheet)",
    color: "var(--color-ink-soft)",
    borderRight: "1px solid var(--color-rule)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-paper) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-paper)", color: "var(--color-ink)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-dye) 18%, transparent)",
  },
  ".cm-tooltip": {
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    border: "1px solid var(--color-rule)",
    backgroundColor: "var(--color-sheet)",
  },
});

const highlight = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: "var(--color-ink)",
    fontWeight: "500",
  },
  { tag: [tags.string, tags.content], color: "var(--color-dye)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-brass)" },
  { tag: tags.comment, color: "#6b7d68", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: "var(--color-ink-soft)" },
]);

export function SourceEditor() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const simulation = useStore((s) => s.simulation);
  const loadCount = useStore((s) => s.loadCount);
  const reveal = useStore((s) => s.reveal);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const editor = new EditorView({
      doc: useStore.getState().text,
      parent: host.current as HTMLDivElement,
      extensions: [
        basicSetup,
        yaml(),
        syntaxHighlighting(highlight),
        lintGutter(),
        theme,
        EditorView.contentAttributes.of({ "aria-label": "Model source" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            const text = editor.state.doc.toString();
            if (text !== useStore.getState().text) useStore.getState().edit(text);
          }, SOLVE_DELAY_MS);
        }),
      ],
    });
    view.current = editor;
    return () => {
      clearTimeout(timer);
      editor.destroy();
    };
  }, []);

  // A model loaded from elsewhere replaces what is in the editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a model is loaded, not on each edit
  useEffect(() => {
    const editor = view.current;
    const { text } = useStore.getState();
    if (!editor || editor.state.doc.toString() === text) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  }, [loadCount]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const { doc } = editor.state;
    const diagnostics = simulation.diagnostics.flatMap((d): EditorDiagnostic[] => {
      // Results can arrive for text that has since been edited.
      if (!d.position || d.position.line > doc.lines) return [];
      const line = doc.line(d.position.line);
      const from = Math.min(line.from + d.position.col - 1, line.to);
      return [{ from, to: Math.max(line.to, from), severity: d.severity, message: d.message }];
    });
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }, [simulation]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !reveal || reveal.line > editor.state.doc.lines) return;
    const line = editor.state.doc.line(reveal.line);
    const anchor = Math.min(line.from + reveal.col - 1, line.to);
    editor.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    editor.focus();
  }, [reveal]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
