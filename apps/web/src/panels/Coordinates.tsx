import { addFrame, type Edit, GROUND } from "@mekasim/core";
import type { Coordinates } from "../coordinates.ts";
import { label, refLabel } from "../names.ts";
import { useStore } from "../store.ts";
import { Choice } from "./Choice.tsx";
import { Field } from "./Field.tsx";

const button = "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft";
const select = "min-w-0 flex-1 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-sm";

/** The chosen coordinates, back on the sheet when the frame they name is no longer in the model. */
export function useCoordinates(): Coordinates {
  const coordinates = useStore((s) => s.coordinates);
  const frames = useStore((s) => s.simulation.doc?.frames);
  const { frame } = coordinates;
  return frame !== undefined && frames?.[frame]
    ? coordinates
    : { ...coordinates, frame: undefined };
}

/** One of a list of things of the model, chosen by name. */
function Pick({
  label: text,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick(value: string): void;
}) {
  return (
    <label className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-ink-soft text-sm">{text}</span>
      <select className={select} value={value} onChange={(event) => onPick(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What a frame's x axis keeps to. */
type Follows = "sheet" | "body" | "along";

/** Where a frame is and how it is turned. */
function FrameFields({ id }: { id: string }) {
  const frame = useStore((s) => s.simulation.doc?.frames?.[id]);
  const compiled = useStore((s) => s.simulation.compiled ?? s.shown?.compiled);
  const apply = useStore((s) => s.apply);
  if (!frame) return null;

  const path = ["frames", id];
  const bodies = [...(compiled?.bodies.values() ?? [])];
  const points = bodies.flatMap((body) =>
    [...body.points.keys()].map((name) => {
      const ref = `${body.id}.${name}`;
      return { value: ref, label: refLabel(ref) };
    }),
  );
  const links = bodies
    .filter((body) => body.id !== GROUND)
    .map((body) => ({ value: body.id, label: label(body.id) }));
  const follows: Follows = frame.along ? "along" : frame.body !== undefined ? "body" : "sheet";

  /** Have the x axis keep to something else, dropping what it kept to before. */
  function follow(next: Follows): void {
    const edits: Edit[] = [];
    if (frame?.along) edits.push({ op: "delete", path: [...path, "along"] });
    if (frame?.body !== undefined) edits.push({ op: "delete", path: [...path, "body"] });
    if (next === "body" && links[0])
      edits.push({ op: "set", path: [...path, "body"], value: links[0].value });
    if (next === "along" && points[0] && points[1]) {
      // From the origin where there is one, to the first other point.
      const from = frame?.origin ?? points[0].value;
      const to = points.find((point) => point.value !== from)?.value as string;
      edits.push({ op: "set", path: [...path, "along"], value: [from, to] });
    }
    apply(edits);
  }

  return (
    <div className="flex flex-col gap-1.5 border-rule border-l-2 pl-2">
      <Pick
        label="Origin"
        value={frame.origin ?? ""}
        options={[{ value: "", label: "The origin of the sheet" }, ...points]}
        onPick={(ref) =>
          apply([
            ref === ""
              ? { op: "delete", path: [...path, "origin"] }
              : { op: "set", path: [...path, "origin"], value: ref },
          ])
        }
      />
      <Pick
        label="Its x axis"
        value={follows}
        options={[
          { value: "sheet", label: "Keeps to the sheet" },
          ...(links.length > 0 ? [{ value: "body", label: "Turns with a link" }] : []),
          ...(points.length > 1
            ? [{ value: "along", label: "Points from one point to another" }]
            : []),
        ]}
        onPick={(next) => follow(next as Follows)}
      />
      {frame.body !== undefined && (
        <Pick
          label="Link"
          value={frame.body}
          options={links}
          onPick={(body) => apply([{ op: "set", path: [...path, "body"], value: body }])}
        />
      )}
      {frame.along?.map((ref, i) => (
        <Pick
          // biome-ignore lint/suspicious/noArrayIndexKey: the two ends of a line are known by their place
          key={i}
          label={i === 0 ? "From" : "To"}
          value={ref}
          options={points}
          onPick={(next) => apply([{ op: "set", path: [...path, "along", i], value: next }])}
        />
      ))}
      <div className="flex items-baseline gap-2">
        <Field
          label={follows === "sheet" ? "Turned" : "Turned from that"}
          path={[...path, "angle"]}
          value={frame.angle}
          optional
          hint="0"
        />
        <button
          type="button"
          className={`${button} shrink-0`}
          onClick={() => apply([{ op: "delete", path }])}
        >
          Remove frame
        </button>
      </div>
    </div>
  );
}

/**
 * The choice of the coordinates in which the motion of what is selected is plotted
 * and measured, with the frame that is chosen laid open to change.
 */
export function CoordinatePicker() {
  const coordinates = useCoordinates();
  const frames = useStore((s) => s.simulation.doc?.frames);
  const setCoordinates = useStore((s) => s.setCoordinates);
  const transact = useStore((s) => s.transact);
  const { frame, polar } = coordinates;

  return (
    <div className="flex flex-col gap-1.5">
      <Choice
        label="Plot and measure its motion as"
        current={polar ? "polar" : "cartesian"}
        options={[
          { value: "cartesian", label: "x and y" },
          { value: "polar", label: "Radius and angle" },
        ]}
        onPick={(kind) => setCoordinates({ ...coordinates, polar: kind === "polar" })}
      />
      <div className="flex items-baseline gap-2">
        <Pick
          label="Seen from"
          value={frame ?? ""}
          options={[
            { value: "", label: "The sheet" },
            ...Object.keys(frames ?? {}).map((id) => ({ value: id, label: label(id) })),
          ]}
          onPick={(id) => setCoordinates({ ...coordinates, frame: id === "" ? undefined : id })}
        />
        <button
          type="button"
          className={`${button} shrink-0`}
          onClick={() =>
            transact((tx) => {
              const added = addFrame(tx.doc, "frame", {});
              tx.run(added.edits);
              setCoordinates({ ...coordinates, frame: added.id });
            })
          }
        >
          New frame
        </button>
      </div>
      {frame !== undefined && <FrameFields id={frame} />}
    </div>
  );
}
