import { Annotation, EditorState, type Extension, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { linkedAt, type Span } from "@mekasim/core";

/**
 * Renaming by editing. With the cursor on the name of a link, a point, a pin, a
 * parameter or a measure where it is defined, every place that refers to it is
 * marked, and what is typed into the name is typed into all of them at once.
 * Editing a reference changes only that reference: it may be meant to point at
 * something else.
 */

/** Marks a change that comes from outside the editor, such as the drawing. It is not a rename. */
export const external = Annotation.define<boolean>();

interface Session {
  definition: Span;
  references: Span[];
}

/** What a name may be made of. */
const NAME = /^[A-Za-z0-9_]*$/;

const session = StateField.define<Session | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    if (next && tr.docChanged) {
      if (tr.annotation(external)) {
        next = null;
      } else {
        // Text typed at either end of the name becomes part of it.
        const follow = (span: Span): Span => ({
          from: tr.changes.mapPos(span.from, -1),
          to: tr.changes.mapPos(span.to, 1),
        });
        next = { definition: follow(next.definition), references: next.references.map(follow) };
        // Stop as soon as the uses no longer read the same as the name.
        const read = (span: Span): string => tr.state.sliceDoc(span.from, span.to);
        const name = read(next.definition);
        if (!NAME.test(name) || next.references.some((span) => read(span) !== name)) next = null;
      }
    }

    const { ranges, main } = tr.state.selection;
    const single = ranges.length === 1;
    const on = (s: Session): boolean =>
      single && main.from >= s.definition.from && main.to <= s.definition.to;
    if (next && !on(next)) next = null;

    // It starts only when the cursor is put on a name, not while one is being typed:
    // a name half typed may spell another name by chance.
    if (!next && tr.selection && !tr.docChanged && single) {
      const linked = linkedAt(tr.state.doc.toString(), main.head);
      if (linked && linked.references.length > 0) {
        next = { definition: linked.definition, references: linked.references };
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (active): DecorationSet => {
      if (!active) return Decoration.none;
      const marks = [
        { span: active.definition, mark: definitionMark },
        ...active.references.map((span) => ({ span, mark: referenceMark })),
      ]
        .filter(({ span }) => span.to > span.from)
        .map(({ span, mark }) => mark.range(span.from, span.to));
      return Decoration.set(marks, true);
    }),
});

const definitionMark = Decoration.mark({ class: "cm-linked-definition" });
const referenceMark = Decoration.mark({ class: "cm-linked-reference" });

/** Repeat what is typed into a definition in every reference to it. */
const mirror = EditorState.transactionFilter.of((tr) => {
  const active = tr.startState.field(session);
  if (!active || !tr.docChanged || tr.annotation(external)) return tr;
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return tr;

  const { definition, references } = active;
  const repeats: { from: number; to: number; insert: string }[] = [];
  let inName = true;
  tr.changes.iterChanges((from, to, _from, _to, inserted) => {
    const insert = inserted.toString();
    if (from < definition.from || to > definition.to || !NAME.test(insert)) {
      inName = false;
      return;
    }
    for (const reference of references) {
      repeats.push({
        from: reference.from + from - definition.from,
        to: reference.from + to - definition.from,
        insert,
      });
    }
  });
  return inName && repeats.length > 0 ? [tr, { changes: repeats }] : tr;
});

const theme = EditorView.baseTheme({
  ".cm-linked-definition": {
    backgroundColor: "color-mix(in srgb, var(--color-dye) 22%, transparent)",
    borderRadius: "2px",
  },
  ".cm-linked-reference": {
    backgroundColor: "color-mix(in srgb, var(--color-dye) 12%, transparent)",
    borderBottom: "1px solid var(--color-dye)",
  },
});

/** The uses of the name the cursor is on, when it is on a definition. For tests and hints. */
export function linkedSpans(state: EditorState): Session | null {
  return state.field(session);
}

export function linkedNames(): Extension {
  return [session, mirror, theme];
}
