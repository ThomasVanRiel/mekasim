import { history } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";

/**
 * The user event of a change that is one step of a continuous gesture outside the
 * editor, such as a drag on the drawing or a slider being moved.
 */
export const LIVE = "input.type.live";

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
