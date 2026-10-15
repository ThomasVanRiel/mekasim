import { label } from "@mekasim/ui";
import { useStore } from "../store.ts";
import { useStudies } from "../study/store.ts";

const button = "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft";

/** Over the sheet while a run of a study is shown in place of the model: which, and the way back. */
export function Replaying() {
  const replay = useStore((state) => state.replay);
  const back = useStore((state) => state.backToModel);
  const takeValues = useStudies((state) => state.takeValues);
  if (!replay) return null;
  const outcome =
    replay.outcome === "passed"
      ? "passed"
      : replay.outcome === "failed"
        ? `failed: ${replay.failed.map(label).join(", ") || "jammed"}`
        : "could not be solved";

  return (
    <div
      role="status"
      className="absolute top-3 left-3 max-w-[60%] border border-ink bg-sheet px-3 py-2 text-sm shadow-sm"
    >
      <p>
        <span className="font-semibold">
          Run {replay.index + 1} of {label(replay.study)}
        </span>
        , {outcome}
      </p>
      {replay.message && <p className="text-ink-soft">{replay.message}</p>}
      {!replay.matches && (
        <p className="text-red">
          Solved again, this run did not come to what the study counted. That is a fault in mekafit;
          please report it with the model.
        </p>
      )}
      <div className="mt-1.5 flex gap-2">
        <button type="button" className={button} onClick={back}>
          Back to the model
        </button>
        <button
          type="button"
          className={button}
          onClick={() => takeValues(replay.study, replay.index)}
        >
          Use these values
        </button>
      </div>
    </div>
  );
}
