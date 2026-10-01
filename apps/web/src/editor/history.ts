import { history } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { LIVE } from "../store.ts";

/**
 * What undoes as one step. Typing in one place without a long pause is one step,
 * as in any editor. The steps of one drag or slider movement on the drawing are
 * one step too, though they change several places in the text.
 *
 * This rule replaces the editor's own, so it has to state both halves.
 */
export function undoGrouping(): Extension {
  return history({
    joinToEvent: (tr, adjacent) => adjacent || tr.isUserEvent(LIVE),
  });
}
