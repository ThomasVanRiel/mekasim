import { addDriver, driversOf, GROUND, jointRefs, toggleTrace } from "@mekasim/core";
import type { ReactNode } from "react";
import { useStore } from "../store.ts";
import { deleteSelection } from "../viewport/tools.ts";
import { Field } from "./Field.tsx";

const button = "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft";

function Section({
  title,
  children,
  removable,
}: {
  title: string;
  children: ReactNode;
  removable?: boolean;
}) {
  return (
    <section aria-label="Selection" className="border-rule border-b">
      <div className="flex items-center justify-between gap-2 border-rule border-b px-3 py-2">
        <h2 className="min-w-0 truncate font-semibold">{title}</h2>
        {removable && (
          <button type="button" className={button} onClick={deleteSelection}>
            Remove
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 px-3 py-2">{children}</div>
    </section>
  );
}

function PointRow({
  body,
  name,
  point,
}: {
  body: string;
  name: string;
  point: [number | string, number | string];
}) {
  const select = useStore((s) => s.select);
  return (
    <div className="flex items-baseline gap-2">
      <button
        type="button"
        className="w-8 shrink-0 text-left font-medium text-sm underline decoration-rule underline-offset-2 hover:decoration-ink"
        onClick={() => select({ kind: "point", ref: `${body}.${name}` })}
      >
        {name}
      </button>
      <Field label="x" path={["bodies", body, "points", name, 0]} value={point[0]} />
      <Field label="y" path={["bodies", body, "points", name, 1]} value={point[1]} />
    </div>
  );
}

/** The properties of whatever is selected in the drawing. */
export function Inspector() {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.simulation.doc);
  const apply = useStore((s) => s.apply);
  const transact = useStore((s) => s.transact);
  if (!selection) return null;
  if (!doc) {
    return (
      <Section title="Selection">
        <p className="text-ink-soft text-sm">
          The source has errors, so its values cannot be shown.
        </p>
      </Section>
    );
  }

  if (selection.kind === "body") {
    const body = doc.bodies[selection.id];
    if (!body) return null;
    const ground = selection.id === GROUND;
    return (
      <Section title={ground ? "Ground" : `Link ${selection.id}`} removable={!ground}>
        {Object.entries(body.points).map(([name, point]) => (
          <PointRow key={name} body={selection.id} name={name} point={point} />
        ))}
        {!ground && (
          <Field
            label="Layer"
            path={["bodies", selection.id, "layer"]}
            value={body.layer}
            optional
            hint="0"
          />
        )}
      </Section>
    );
  }

  if (selection.kind === "point") {
    const [bodyId, name] = selection.ref.split(".") as [string, string];
    const point = doc.bodies[bodyId]?.points[name];
    if (!point) return null;
    const traced = doc.traces?.includes(selection.ref) ?? false;
    return (
      <Section title={`Point ${selection.ref}`} removable>
        <PointRow body={bodyId} name={name} point={point} />
        {bodyId !== GROUND && (
          <button
            type="button"
            className={`${button} self-start`}
            aria-pressed={traced}
            onClick={() => transact((tx) => tx.run(toggleTrace(tx.doc, selection.ref)))}
          >
            {traced ? "Stop recording its path" : "Record its path"}
          </button>
        )}
      </Section>
    );
  }

  const joint = doc.joints?.[selection.id];
  if (!joint) return null;
  const refs = jointRefs(joint);
  const drivers = driversOf(doc, selection.id);
  return (
    <Section title={`${joint.type === "revolute" ? "Pin" : "Joint"} ${selection.id}`} removable>
      <p className="text-sm">
        {joint.type === "revolute" || joint.type === "weld"
          ? `${joint.type === "weld" ? "Welds" : "Pins"} ${refs[0]} to ${refs[1]}.`
          : `Keeps ${refs[2]} on the line through ${refs[0]} and ${refs[1]}.`}
      </p>
      {"angle" in joint && (
        <Field
          label="Angle"
          path={["joints", selection.id, "angle"]}
          value={joint.angle}
          optional
          hint="0"
        />
      )}
      {drivers.map((id) => (
        <div key={id} className="flex flex-col gap-1.5 border-rule border-t pt-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">Motor {id}</span>
            <button
              type="button"
              className={button}
              onClick={() => apply([{ op: "delete", path: ["drivers", id] }])}
            >
              Remove motor
            </button>
          </div>
          <Field
            label="Speed"
            path={["drivers", id, "speed"]}
            value={doc.drivers?.[id]?.speed}
            hint="rpm"
          />
          <Field
            label="Start angle"
            path={["drivers", id, "phase"]}
            value={doc.drivers?.[id]?.phase}
            optional
            hint="0"
          />
        </div>
      ))}
      {joint.type === "revolute" && drivers.length === 0 && (
        <button
          type="button"
          className={`${button} self-start`}
          onClick={() => transact((tx) => tx.run(addDriver(tx.doc, selection.id).edits))}
        >
          Add a motor
        </button>
      )}
    </Section>
  );
}
