import type { Drawing, Files, GeometrySource, ShapeUse } from "@mekasim/core";
import { useMemo, useRef } from "react";
import { label } from "../names.ts";
import { thumbOf } from "./thumb.ts";

const small =
  "shrink-0 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-[12px] hover:border-ink-soft active:bg-paper";

/** Metres to a unit, as the name of the unit. */
function unitName(metres: number): string {
  const names: [number, string][] = [
    [0.001, "mm"],
    [0.01, "cm"],
    [1, "m"],
    [0.0254, "in"],
  ];
  return names.find(([size]) => Math.abs(size - metres) < 1e-12)?.[1] ?? `${metres} m`;
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const place = ([x, y]: [number, number]): string =>
  `(${Number(x.toPrecision(6))}, ${Number(y.toPrecision(6))})`;

/** A button that picks one DXF file and hands over its text. */
function PickDrawing({ children, onPick }: { children: string; onPick(text: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={small} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".dxf"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(await file.text());
        }}
      />
    </>
  );
}

/** A small picture of a layer: its outlines filled, and what does not close in red. */
function Picture({ drawing, layer }: { drawing: Drawing; layer: string }) {
  const thumb = useMemo(
    () =>
      thumbOf(
        drawing.layers.get(layer) ?? [],
        drawing.open.filter((open) => open.layer === layer).map((open) => open.chain),
      ),
    [drawing, layer],
  );
  if (!thumb) return null;
  return (
    <svg
      viewBox={thumb.viewBox}
      role="img"
      aria-label={`What is on layer ${layer}`}
      className="h-12 w-20"
    >
      <g transform="scale(1 -1)" strokeLinejoin="round">
        <path
          d={thumb.closed}
          fillRule="evenodd"
          className="fill-rule stroke-ink"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
        />
        <path
          d={thumb.open}
          className="fill-none stroke-red"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.5}
        />
      </g>
    </svg>
  );
}

/** What one drawing holds: its layers with their outlines, who uses them, and what was left out. */
function Report({ drawing, uses }: { drawing: Drawing; uses: ShapeUse[] }) {
  const skipped = [...drawing.skipped];
  const curves = drawing.fitted.reduce((sum, fitted) => sum + fitted.curves, 0);
  const pieces = drawing.fitted.reduce((sum, fitted) => sum + fitted.segments, 0);
  return (
    <>
      <p className="text-ink-soft text-sm">
        {drawing.unit === undefined
          ? "The file does not say its unit."
          : `Drawn in ${unitName(drawing.unit)}${drawing.unitGiven ? ", as the model says" : ", as the file says"}.`}
      </p>
      {drawing.layers.size === 0 ? (
        <p className="text-sm">No closed outline was found in it.</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Layers of {drawing.file}</caption>
          <thead>
            <tr className="text-left text-[12px] text-ink-soft">
              <th className="py-0.5 pr-2 font-normal">
                <span className="sr-only">Picture</span>
              </th>
              <th className="py-0.5 pr-2 font-normal">Layer</th>
              <th className="py-0.5 pr-2 font-normal">Outlines</th>
              <th className="py-0.5 font-normal">Used by</th>
            </tr>
          </thead>
          <tbody>
            {[...drawing.layers].map(([layer, outlines]) => {
              const holes = outlines.reduce((sum, outline) => sum + outline.holes.length, 0);
              const users = uses.filter((use) => use.layer === layer).map((use) => label(use.body));
              return (
                <tr key={layer} className="border-rule border-t align-middle">
                  <td className="w-20 py-1 pr-2">
                    <Picture drawing={drawing} layer={layer} />
                  </td>
                  <th
                    scope="row"
                    className="py-0.5 pr-2 text-left font-mono font-normal text-[12px]"
                  >
                    {layer}
                  </th>
                  <td className="py-0.5 pr-2 tabular-nums">
                    {outlines.length}
                    {holes > 0 && <span className="text-ink-soft">, {plural(holes, "hole")}</span>}
                  </td>
                  <td className={`py-0.5 ${users.length === 0 ? "text-ink-soft" : ""}`}>
                    {users.join(", ") || "Nothing yet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {drawing.open.length > 0 && (
        <div className="border border-red px-2 py-1 text-sm">
          <p>
            {plural(drawing.open.length, "outline does", "outlines do")} not close, and cannot be a
            shape:
          </p>
          <ul className="mt-0.5 text-ink-soft">
            {drawing.open.slice(0, 6).map(({ layer, chain }) => (
              <li key={`${layer} ${chain.from} ${chain.to}`}>
                on <span className="font-mono text-[12px]">{layer}</span>, open between{" "}
                {place(chain.from)} and {place(chain.to)}
              </li>
            ))}
            {drawing.open.length > 6 && <li>and {drawing.open.length - 6} more</li>}
          </ul>
        </div>
      )}
      {curves > 0 && (
        <p className="text-ink-soft text-sm">
          {plural(curves, "curve that is not an arc was", "curves that are not arcs were")} replaced
          by {plural(pieces, "arc")}, within {Number((drawing.fit * 1000).toPrecision(3))} mm of{" "}
          {curves === 1 ? "it" : "them"}, on{" "}
          {drawing.fitted.map(({ layer }, i) => (
            <span key={layer}>
              {i > 0 && ", "}
              <span className="font-mono text-[12px]">{layer}</span>
            </span>
          ))}
          .
        </p>
      )}
      {skipped.length > 0 && (
        <p className="text-ink-soft text-sm">
          Left out: {skipped.map(([kind, count]) => `${count} ${kind}`).join(", ")}.
        </p>
      )}
      {drawing.dropped > 0 && (
        <p className="text-ink-soft text-sm">
          {plural(drawing.dropped, "segment")} drawn twice or of no length{" "}
          {drawing.dropped === 1 ? "was" : "were"} dropped.
        </p>
      )}
    </>
  );
}

/** What it means for the model that a drawing is not attached. */
function Detached({ uses }: { uses: ShapeUse[] }) {
  const without = uses.filter((use) => !use.kept).map((use) => label(use.body));
  if (without.length === 0) {
    return (
      <p className="text-ink-soft text-sm">
        Not attached. The model keeps the outlines it took from it, so nothing is missing; attach
        the drawing to see what it holds, or a newer one to change the outlines.
      </p>
    );
  }
  return (
    <p className="border border-brass px-2 py-1 text-sm">
      Not attached, and the model keeps no outline for {without.join(", ")}:{" "}
      {without.length === 1 ? "it is" : "they are"} drawn without{" "}
      {without.length === 1 ? "a shape" : "shapes"}.
    </p>
  );
}

/**
 * The drawings of the model: which are attached, what each holds, and which body
 * takes its outline from where. Drawings are added and exchanged for newer ones here.
 */
export function Geometry({
  sources,
  drawings,
  uses,
  files,
  onAdd,
  onReplace,
}: {
  /** What the model says under `geometry`, by name. */
  sources: Record<string, GeometrySource>;
  /** The drawings that are attached and could be read, by that name. */
  drawings: ReadonlyMap<string, Drawing>;
  /** The bodies that take their shape from a drawing. */
  uses: ShapeUse[];
  /** The files that are attached, by the name the model knows each under. */
  files: Files;
  /** Drawings were picked to add to the model, by their file names. */
  onAdd(picked: Map<string, string>): void;
  /** A file was picked to stand for a drawing the model names. */
  onReplace(file: string, text: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const names = Object.keys(sources);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-baseline gap-2 border-rule border-b px-3 py-2">
        <p className="min-w-0 flex-1 text-ink-soft text-sm">
          {names.length === 0
            ? "No drawings yet. Add one to take the outlines of parts from it."
            : "The drawings this model takes outlines from."}
        </p>
        <button type="button" className={small} onClick={() => input.current?.click()}>
          Add drawing (DXF)
        </button>
        <input
          ref={input}
          type="file"
          accept=".dxf"
          multiple
          className="hidden"
          onChange={async (event) => {
            const picked = [...(event.target.files ?? [])];
            event.target.value = "";
            const read = await Promise.all(
              picked.map(async (file) => [file.name, await file.text()] as const),
            );
            onAdd(new Map(read));
          }}
        />
      </div>
      {names.map((name) => {
        const source = sources[name] as (typeof sources)[string];
        const drawing = drawings.get(name);
        const attached = files.has(source.file);
        return (
          <section
            key={name}
            aria-label={`Drawing ${name}`}
            className="flex flex-col gap-1.5 border-rule border-b px-3 py-2"
          >
            <h3 className="flex items-baseline gap-2">
              <span className="font-semibold">{label(name)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft">
                {source.file}
              </span>
              <PickDrawing onPick={(text) => onReplace(source.file, text)}>
                {attached ? "Replace" : "Attach"}
              </PickDrawing>
            </h3>
            {!attached ? (
              <Detached uses={uses.filter((use) => use.from === name)} />
            ) : drawing ? (
              <Report drawing={drawing} uses={uses.filter((use) => use.from === name)} />
            ) : (
              <p className="text-sm">It could not be read; see the messages below.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
