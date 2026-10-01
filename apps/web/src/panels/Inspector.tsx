import {
  addDriver,
  addPlot,
  driversOf,
  type Edit,
  GROUND,
  jointRefs,
  toggleTrace,
} from "@mekasim/core";
import type { ReactNode } from "react";
import { label, refLabel, titled } from "../names.ts";
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

/** What each kind of joint is called. */
const JOINT_NAMES = {
  revolute: "Pin",
  weld: "Weld",
  slider: "Slot",
  "pin-slot": "Slot",
  distance: "Tie",
  gear: "Gear",
  belt: "Belt",
  cam: "Cam",
} as const;

/** A choice between a few named options, shown as buttons side by side. */
function Choice<T extends string>({
  label,
  current,
  options,
  onPick,
}: {
  label: string;
  current: T;
  options: { value: T; label: string }[];
  onPick(value: T): void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-ink-soft text-sm">{label}</legend>
      <div className="flex flex-wrap">
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === current}
            onClick={() => option.value !== current && onPick(option.value)}
            className={`border px-2 py-0.5 text-sm ${i > 0 ? "-ml-px" : ""} ${
              option.value === current
                ? "border-ink bg-ink text-sheet"
                : "border-rule bg-sheet hover:border-ink-soft"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Buttons that add a chart of something to the model. */
function PlotButtons({ plots }: { plots: { label: string; name: string; series: string[] }[] }) {
  const transact = useStore((s) => s.transact);
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-ink-soft text-sm">Plot</span>
      {plots.map(({ label, name, series }) => (
        <button
          key={label}
          type="button"
          className={button}
          onClick={() => transact((tx) => tx.run(addPlot(tx.doc, name, series).edits))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type Doc = NonNullable<ReturnType<typeof useStore.getState>["simulation"]["doc"]>;

/** The component a body or a joint was made from, if it was. */
function componentOf(doc: Doc, id: string): string | undefined {
  if (doc.components?.[id]) return id;
  const rod = id.replace(/_[ab]$/, "");
  return doc.components?.[rod]?.type === "rod" ? rod : undefined;
}

/** The values of a crank or a rod. */
function ComponentSection({ doc, id }: { doc: Doc; id: string }) {
  const component = doc.components?.[id];
  if (!component) return null;
  const path = ["components", id];

  if (component.type === "rod") {
    return (
      <Section title={titled("Rod", id)} removable>
        <p className="text-sm">
          Pinned to {refLabel(component.connect[0])} and {refLabel(component.connect[1])}.
        </p>
        <Field label="Length" path={[...path, "length"]} value={component.length} />
        <Field
          label="Layer"
          path={[...path, "layer"]}
          value={component.layer}
          optional
          hint="automatic"
        />
        <PlotButtons
          plots={[
            { label: "angle", name: `${id}_angle`, series: [`angle(${id})`] },
            { label: "turning speed", name: `${id}_omega`, series: [`omega(${id})`] },
          ]}
        />
      </Section>
    );
  }

  const { at } = component;
  return (
    <Section title={titled("Crank", id)} removable>
      {typeof at === "string" ? (
        <p className="text-sm">Pivots on {refLabel(at)}.</p>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="w-8 shrink-0 text-ink-soft text-sm">Pivot</span>
          <Field label="x" path={[...path, "at", 0]} value={at[0]} />
          <Field label="y" path={[...path, "at", 1]} value={at[1]} />
        </div>
      )}
      {Object.entries(component.arms).map(([name, [radius, angle]]) => (
        <div key={name} className="flex items-baseline gap-2">
          <span className="w-8 shrink-0 font-medium text-sm">{name}</span>
          <Field label="radius" path={[...path, "arms", name, 0]} value={radius} />
          <Field label="angle" path={[...path, "arms", name, 1]} value={angle} />
        </div>
      ))}
      <Field
        label="Turned at start"
        path={[...path, "angle"]}
        value={component.angle}
        optional
        hint="0"
      />
      <Field
        label="Driven at"
        path={[...path, "speed"]}
        value={component.speed}
        optional
        hint="not driven; rpm"
      />
      <Field
        label="Layer"
        path={[...path, "layer"]}
        value={component.layer}
        optional
        hint="automatic"
      />
      <PlotButtons
        plots={[
          { label: "angle", name: `${id}_angle`, series: [`angle(${id})`] },
          { label: "turning speed", name: `${id}_omega`, series: [`omega(${id})`] },
        ]}
      />
    </Section>
  );
}

/** Shown for a point or joint that a component stands for: it is changed through the component. */
function PartOf({ title, component }: { title: string; component: string }) {
  const select = useStore((s) => s.select);
  return (
    <Section title={title}>
      <p className="text-sm">This is part of {label(component)}, and is changed through it.</p>
      <button
        type="button"
        className={`${button} self-start`}
        onClick={() => select({ kind: "body", id: component })}
      >
        Show {label(component)}
      </button>
    </Section>
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
    if (!body) return <ComponentSection doc={doc} id={selection.id} />;
    const ground = selection.id === GROUND;
    return (
      <Section title={ground ? "Ground" : titled("Link", selection.id)} removable={!ground}>
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
        {!ground && (
          <PlotButtons
            plots={[
              { label: "angle", name: `${selection.id}_angle`, series: [`angle(${selection.id})`] },
              {
                label: "turning speed",
                name: `${selection.id}_omega`,
                series: [`omega(${selection.id})`],
              },
            ]}
          />
        )}
      </Section>
    );
  }

  if (selection.kind === "point") {
    const [bodyId, name] = selection.ref.split(".") as [string, string];
    const point = doc.bodies[bodyId]?.points[name];
    if (!point) {
      // A point of a crank or rod, or the ground point a crank pivots on.
      const owner = componentOf(doc, bodyId === GROUND ? name : bodyId);
      return owner ? <PartOf title={`Point ${refLabel(selection.ref)}`} component={owner} /> : null;
    }
    const traced = doc.traces?.includes(selection.ref) ?? false;
    return (
      <Section title={`Point ${refLabel(selection.ref)}`} removable>
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
        {bodyId !== GROUND && (
          <PlotButtons
            plots={[
              {
                label: "position",
                name: `${bodyId}_${name}`,
                series: [`x(${selection.ref})`, `y(${selection.ref})`],
              },
              { label: "speed", name: `${bodyId}_${name}_speed`, series: [`v(${selection.ref})`] },
              {
                label: "acceleration",
                name: `${bodyId}_${name}_accel`,
                series: [`a(${selection.ref})`],
              },
            ]}
          />
        )}
      </Section>
    );
  }

  const joint = doc.joints?.[selection.id];
  if (!joint) {
    const owner = componentOf(doc, selection.id);
    return owner ? <PartOf title={titled("Pin", selection.id)} component={owner} /> : null;
  }
  const named = jointRefs(joint).map(refLabel);
  const drivers = driversOf(doc, selection.id);
  const path = ["joints", selection.id];
  /** Change the kind of joint, dropping what the new kind has no use for. */
  const retype = (type: string, drop: Edit[] = []): void => {
    apply([{ op: "set", path: [...path, "type"], value: type }, ...drop]);
  };
  return (
    <Section title={titled(JOINT_NAMES[joint.type], selection.id)} removable>
      <p className="text-sm">
        {joint.type === "revolute" || joint.type === "weld"
          ? `${joint.type === "weld" ? "Welds" : "Pins"} ${named[0]} to ${named[1]}.`
          : joint.type === "slider" || joint.type === "pin-slot"
            ? `Keeps ${named[2]} on the line through ${named[0]} and ${named[1]}.`
            : joint.type === "cam"
              ? `${named[1]} rides on a cam centred on ${named[0]}.`
              : joint.type === "distance"
                ? `Holds ${named[0]} and ${named[1]} a fixed distance apart.`
                : `Ties the turning of the bodies centred on ${named[0]} and ${named[1]}.`}
      </p>

      {(joint.type === "revolute" || joint.type === "weld") && (
        <Choice
          label="The two bodies"
          current={joint.type}
          options={[
            { value: "revolute", label: "Turn freely" },
            { value: "weld", label: "Are fixed together" },
          ]}
          onPick={(type) =>
            retype(
              type,
              type === "weld"
                ? drivers.map((id): Edit => ({ op: "delete", path: ["drivers", id] }))
                : [{ op: "delete", path: [...path, "angle"] }],
            )
          }
        />
      )}
      {(joint.type === "slider" || joint.type === "pin-slot") && (
        <Choice
          label="The sliding body"
          current={joint.type}
          options={[
            { value: "pin-slot", label: "Turns freely" },
            { value: "slider", label: "Stays square" },
          ]}
          onPick={(type) =>
            retype(type, type === "pin-slot" ? [{ op: "delete", path: [...path, "angle"] }] : [])
          }
        />
      )}
      {(joint.type === "gear" || joint.type === "belt") && (
        <>
          <Choice
            label="The two wheels"
            current={joint.type}
            options={[
              { value: "gear", label: "Mesh as gears" },
              { value: "belt", label: "Share a belt" },
            ]}
            onPick={(type) => retype(type)}
          />
          <div className="flex items-baseline gap-2">
            <Field label="Size" path={[...path, "sizes", 0]} value={joint.sizes[0]} />
            <Field label="and" path={[...path, "sizes", 1]} value={joint.sizes[1]} />
          </div>
          <p className="text-ink-soft text-sm">
            Tooth counts or diameters; only their ratio matters. Gears turn against each other,
            belted wheels the same way.
          </p>
        </>
      )}
      {joint.type === "distance" && (
        <Field label="Distance" path={[...path, "length"]} value={joint.length} />
      )}
      {joint.type === "cam" && (
        <>
          <Field label="Base radius" path={[...path, "base"]} value={joint.base} />
          <Field
            label="Roller radius"
            path={[...path, "roller"]}
            value={joint.roller}
            optional
            hint="0"
          />
          <Choice
            label="Between points the lift moves"
            current={joint.law ?? "cycloidal"}
            options={[
              { value: "cycloidal", label: "Cycloidal" },
              { value: "polynomial", label: "3-4-5" },
              { value: "harmonic", label: "Harmonic" },
            ]}
            onPick={(law) => apply([{ op: "set", path: [...path, "law"], value: law }])}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-ink-soft text-sm">Lift at angles round the cam</span>
            {joint.profile.map(([angle, lift], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the points of a lift diagram are known by their place
              <div key={i} className="flex items-baseline gap-2">
                <Field label="at" path={[...path, "profile", i, 0]} value={angle} />
                <Field label="lift" path={[...path, "profile", i, 1]} value={lift} />
                <button
                  type="button"
                  aria-label={`Remove lift point ${i + 1}`}
                  className="shrink-0 px-1 text-ink-soft hover:text-red"
                  onClick={() => apply([{ op: "delete", path: [...path, "profile", i] }])}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${button} self-start`}
              onClick={() => {
                const last = joint.profile.at(-1);
                const angle = typeof last?.[0] === "number" ? Math.min(last[0] + 30, 359) : 0;
                apply([
                  {
                    op: "set",
                    path: [...path, "profile", joint.profile.length],
                    value: [angle, last?.[1] ?? 0],
                  },
                ]);
              }}
            >
              Add a lift point
            </button>
          </div>
        </>
      )}

      {"angle" in joint && (
        <Field label="Angle" path={[...path, "angle"]} value={joint.angle} optional hint="0" />
      )}
      {drivers.map((id) => (
        <div key={id} className="flex flex-col gap-1.5 border-rule border-t pt-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{titled("Motor", id)}</span>
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
