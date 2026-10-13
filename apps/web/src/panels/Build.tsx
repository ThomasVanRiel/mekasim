import {
  buildParts,
  checkFabrication,
  docFactor,
  type Fabrication,
  LENGTH,
  layoutParts,
  pinDiameters,
  toDxf,
  toPointsDxf,
} from "@mekasim/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { download, fileStem } from "../io/download.ts";
import { toStl } from "../io/stl.ts";
import { label } from "../names.ts";
import { formatNumber } from "../plot/geometry.ts";
import { useStore } from "../store.ts";
import { Field } from "./Field.tsx";

const button =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm enabled:hover:border-ink-soft disabled:opacity-40";

/**
 * "Make" in the header: a button that opens the sizes and the downloads below it,
 * over the side panel, so that the drawing stays in view while a size is changed.
 * A press anywhere else, or Esc, puts it away.
 */
export function Make({ className }: { className: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPress(event: PointerEvent): void {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      // In a field Esc puts the old value back; anywhere else it closes the panel.
      if (event.key !== "Escape" || event.target instanceof HTMLInputElement) return;
      event.stopPropagation();
      setOpen(false);
    }
    // Heard on the way down, so that nothing underneath can keep the press or the key to itself.
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className="hidden lg:block">
      <button
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={id}
        title="Real sizes of the parts, and files to cut or print them from"
        onClick={() => setOpen(!open)}
      >
        Make
      </button>
      {open && (
        <section
          id={id}
          aria-label="Parts to make"
          className="absolute top-full right-4 z-40 -mt-px w-80 border border-rule bg-sheet"
        >
          <h2 className="border-rule border-b px-3 py-2 font-semibold">Parts to make</h2>
          <Build />
        </section>
      )}
    </div>
  );
}

/**
 * The real sizes of the parts, and their export as flat pieces to cut or print, or
 * as the joints alone to draw on. A size left empty is the one the drawing already uses.
 */
function Build() {
  const shown = useStore((s) => s.shown);
  const scene = useStore((s) => s.scene);
  const written = useStore((s) => s.simulation.doc?.fabrication);
  const hasDoc = useStore((s) => s.simulation.doc !== undefined);

  const half = scene?.sizes.half;
  const thickness = scene?.sizes.thickness;
  const pin = scene?.sizes.pin;
  const clearance = shown?.compiled?.fabrication.clearance ?? 0;
  const sizes = useMemo<Fabrication | undefined>(
    () =>
      half === undefined || thickness === undefined || pin === undefined
        ? undefined
        : { width: 2 * half, thickness, hole: 2 * pin, clearance },
    [half, thickness, pin, clearance],
  );
  const parts = useMemo(() => {
    if (!shown || !sizes || checkFabrication(sizes).length > 0) return [];
    // Parts lie a few millimetres apart, enough for a cut or a print to keep them separate.
    return layoutParts(buildParts(shown, sizes), Math.max(sizes.width / 4, 0.003));
  }, [shown, sizes]);

  // Pins that had to be made smaller than asked for, as on an eccentric with a small throw.
  const crowded = useMemo(() => {
    const compiled = shown?.compiled;
    if (!compiled || !sizes) return [];
    return [...pinDiameters(compiled, sizes.hole)]
      .filter(([, diameter]) => diameter < sizes.hole - 1e-9)
      .map(([id]) => id);
  }, [shown, sizes]);

  const units = shown?.compiled?.units;
  if (!shown || !units || !sizes)
    return (
      <p className="px-3 py-2 text-ink-soft text-sm">
        Nothing to make yet. Once the model runs, its parts can be sized and downloaded here.
      </p>
    );
  const unit = docFactor(LENGTH, units);
  const problems = checkFabrication(sizes);
  const automatic = (size: number): string => `${formatNumber(size / unit, 3)} ${units.length}`;
  const stem = fileStem(shown.doc?.meta?.name);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {hasDoc && (
        <>
          <Field
            label="Link width"
            path={["fabrication", "width"]}
            value={written?.width}
            optional
            hint={automatic(sizes.width)}
          />
          <Field
            label="Thickness"
            path={["fabrication", "thickness"]}
            value={written?.thickness}
            optional
            hint={automatic(sizes.thickness)}
          />
          <Field
            label="Pin diameter"
            path={["fabrication", "hole"]}
            value={written?.hole}
            optional
            hint={automatic(sizes.hole)}
          />
          <Field
            label="Clearance"
            path={["fabrication", "clearance"]}
            value={written?.clearance}
            optional
            hint={automatic(0)}
          />
        </>
      )}
      <p className="text-ink-soft text-sm">
        A size left empty is the one the drawing uses now. Fill them in to draw the links true to
        size. Holes are the pin diameter plus the clearance.
      </p>
      {crowded.length > 0 && (
        <p className="border border-rule bg-paper px-2 py-1 text-sm">
          Some pins sit closer together than a pin is wide, so they and their holes are made smaller
          to fit: {crowded.map(label).join(", ")}.
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="border border-red px-2 py-1 text-sm">
          {problem}
        </p>
      ))}
      {parts.length > 0 && (
        <p className="text-sm">
          {parts.length} flat {parts.length === 1 ? "piece" : "pieces"}:{" "}
          {parts.map((part) => label(part.id)).join(", ")}.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={button}
          disabled={parts.length === 0}
          onClick={() => download(`${stem}.dxf`, toDxf(parts, units, label), "image/vnd.dxf")}
        >
          Download DXF to cut
        </button>
        <button
          type="button"
          className={button}
          disabled={parts.length === 0}
          onClick={() => download(`${stem}.stl`, toStl(parts, sizes.thickness), "model/stl")}
        >
          Download STL to print
        </button>
        <button
          type="button"
          className={button}
          title="The joints at the start of the cycle, and the links as lines, for a CAD program"
          disabled={!shown.cycle?.count}
          onClick={() => download(`${stem}-points.dxf`, toPointsDxf(shown, label), "image/vnd.dxf")}
        >
          Download DXF of the points
        </button>
      </div>
    </div>
  );
}
