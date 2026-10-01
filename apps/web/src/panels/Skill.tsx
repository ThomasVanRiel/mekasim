import { useCallback, useState } from "react";
import { download } from "../io/download.ts";
import { useLayout } from "../layout.ts";
import { SKILL, SKILL_FILE } from "../skill/skill.ts";
import { FOLD_BUTTON, Fold } from "./Fold.tsx";

/** The panel's id, for the button that folds it open. */
export const SKILL_ID = "ai-skill";

/**
 * The skill for an AI assistant, folded open beside the source: what it is for, how
 * to hand it to an assistant, and the text itself, to copy or to save.
 */
export function Skill() {
  const open = useLayout((s) => s.skill);
  const setSkill = useLayout((s) => s.setSkill);
  const close = useCallback(() => setSkill(false), [setSkill]);
  const [copied, setCopied] = useState<"copied" | "failed">();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(SKILL);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(undefined), 2500);
  }

  return (
    <Fold
      id={SKILL_ID}
      label="A skill for an AI assistant"
      title="Drawing with an AI assistant"
      open={open}
      onClose={close}
      actions={
        <>
          <button type="button" onClick={copy} className={FOLD_BUTTON}>
            {copied === "copied"
              ? "Skill copied"
              : copied === "failed"
                ? "Could not copy"
                : "Copy the skill"}
          </button>
          <button
            type="button"
            onClick={() => download(SKILL_FILE, SKILL, "text/markdown")}
            className={FOLD_BUTTON}
          >
            Download {SKILL_FILE}
          </button>
        </>
      }
    >
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl">
          <p className="my-2">
            An AI assistant such as Claude or ChatGPT can write a model from a description: “a
            windscreen wiper”, “a toggle clamp with a 40 mm stroke”. It has to know how a model is
            written first. The text below tells it: how to go about it, the whole format, and
            examples.
          </p>
          <ul className="my-2 list-disc space-y-1 pl-5">
            <li>
              Copy the skill and paste it at the start of a conversation. Where the assistant keeps
              skills, download the file and add it there instead, and it is at hand in every
              conversation.
            </li>
            <li>Describe the mechanism, with the dimensions you care about.</li>
            <li>Paste the YAML it answers with into the source here, in place of what is there.</li>
            <li>
              If the list under the source reports a problem, or the mechanism is put together the
              wrong way round, tell the assistant what you see and paste its next answer.
            </li>
          </ul>
          <pre className="mt-4 whitespace-pre-wrap border border-rule bg-paper px-3 py-2 font-mono text-[13px] leading-normal">
            {SKILL}
          </pre>
        </div>
      </div>
    </Fold>
  );
}
