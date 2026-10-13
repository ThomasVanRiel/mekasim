import { redo, undo } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic as EditorDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Diagnostic } from "@mekasim/core";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { useTheme } from "../theme.ts";
import { undoGrouping } from "./history.ts";
import { external, linkedNames } from "./linked.ts";

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

/** Tells the editor which of its own colours to use where the theme above names none. */
const dark = new Compartment();

const highlight = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: "var(--color-ink)",
    fontWeight: "500",
  },
  { tag: [tags.string, tags.content], color: "var(--color-dye)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-brass)" },
  { tag: tags.comment, color: "var(--comment)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: "var(--color-ink-soft)" },
]);

/** What an app can ask of the editor, which owns the text being typed and its undo history. */
export interface EditorHandle {
  /** The text as it is in the editor now, which may be ahead of what was last handed on. */
  text(): string;
  undo(): void;
  redo(): void;
}

/**
 * The source of a model: YAML with the app's colours, the messages marked on their
 * lines, and renaming by editing a name where it is defined. The app holds the text
 * and is told of changes; the editor holds the cursor and the undo history.
 */
export function SourceEditor({
  text,
  diagnostics,
  reveal,
  onEdit,
  onCursor,
  syncEvent,
  onReady,
}: {
  /** The model's text. A change made elsewhere is written into the editor in place. */
  text: string;
  /** The messages to mark on their lines. */
  diagnostics: Diagnostic[];
  /** A place to put the cursor and bring into view; a new `request` asks again. */
  reveal?: { line: number; col: number; request: number; focus: boolean };
  /** Called with the text once typing pauses, and at once after an undo or redo. */
  onEdit(text: string): void;
  /** Called with where the cursor is while the editor has the keyboard, and with undefined when it has not. */
  onCursor?(at: { text: string; offset: number } | undefined): void;
  /** The user event to record a change from elsewhere under, read when it happens. */
  syncEvent?(): string | undefined;
  /** Called with the handle when the editor is there, and with undefined when it goes. */
  onReady?(handle: EditorHandle | undefined): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  // The editor is made once; what it calls back to is whatever was given last.
  const latest = useRef({ text, onEdit, onCursor, syncEvent, onReady });
  latest.current = { text, onEdit, onCursor, syncEvent, onReady };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const editor = new EditorView({
      doc: latest.current.text,
      parent: host.current as HTMLDivElement,
      extensions: [
        basicSetup,
        yaml(),
        syntaxHighlighting(highlight),
        lintGutter(),
        linkedNames(),
        theme,
        dark.of(EditorView.darkTheme.of(useTheme.getState().theme === "dark")),
        EditorView.contentAttributes.of({ "aria-label": "Model source" }),
        undoGrouping(),
        EditorView.updateListener.of((update) => {
          // Show in the drawing what the cursor is on, for as long as the source has the keyboard.
          if (update.focusChanged || update.selectionSet || update.docChanged) {
            const { state, hasFocus } = update.view;
            latest.current.onCursor?.(
              hasFocus
                ? { text: state.doc.toString(), offset: state.selection.main.head }
                : undefined,
            );
          }
          if (!update.docChanged) return;
          const solveNow = (): void => {
            const current = editor.state.doc.toString();
            if (current !== latest.current.text) latest.current.onEdit(current);
          };
          clearTimeout(timer);
          // Typing waits for a pause; undo and redo show their result at once.
          const stepped = update.transactions.some(
            (tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"),
          );
          if (stepped) solveNow();
          else timer = setTimeout(solveNow, SOLVE_DELAY_MS);
        }),
      ],
    });
    view.current = editor;
    latest.current.onReady?.({
      text: () => editor.state.doc.toString(),
      undo: () => undo(editor),
      redo: () => redo(editor),
    });
    const unsubscribe = useTheme.subscribe(({ theme }) => {
      editor.dispatch({ effects: dark.reconfigure(EditorView.darkTheme.of(theme === "dark")) });
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      latest.current.onReady?.(undefined);
      editor.destroy();
    };
  }, []);

  // Text changed from outside the editor (the drawing, a panel, a loaded file) is
  // written into it as the smallest replacement, so the cursor and undo history survive.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === text) return;
    let from = 0;
    const shortest = Math.min(current.length, text.length);
    while (from < shortest && current[from] === text[from]) from++;
    let to = current.length;
    let end = text.length;
    while (to > from && end > from && current[to - 1] === text[end - 1]) {
      to--;
      end--;
    }
    editor.dispatch({
      changes: { from, to, insert: text.slice(from, end) },
      userEvent: latest.current.syncEvent?.(),
      // Not typed here, so not a rename of whatever name the cursor happens to be on.
      annotations: external.of(true),
    });
  }, [text]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const { doc } = editor.state;
    const marks = diagnostics.flatMap((d): EditorDiagnostic[] => {
      // Results can arrive for text that has since been edited.
      if (!d.position || d.position.line > doc.lines) return [];
      const line = doc.line(d.position.line);
      const from = Math.min(line.from + d.position.col - 1, line.to);
      return [{ from, to: Math.max(line.to, from), severity: d.severity, message: d.message }];
    });
    editor.dispatch(setDiagnostics(editor.state, marks));
  }, [diagnostics]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !reveal || reveal.line > editor.state.doc.lines) return;
    const line = editor.state.doc.line(reveal.line);
    const anchor = Math.min(line.from + reveal.col - 1, line.to);
    editor.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    if (reveal.focus) editor.focus();
  }, [reveal]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
