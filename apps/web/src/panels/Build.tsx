import {
  buildParts,
  checkFabrication,
  docFactor,
  type Fabrication,
  LENGTH,
  layoutParts,
  toDxf,
} from "@mekasim/core";
import { useMemo } from "react";
import { download, fileStem } from "../io/download.ts";
import { toStl } from "../io/stl.ts";
import { label } from "../names.ts";
import { formatNumber } from "../plot/geometry.ts";
import { useStore } from "../store.ts";
import { Field } from "./Field.tsx";

const button =
  "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm enabled:hover:border-ink-soft disabled:opacity-40";

/**
 * The real sizes of the parts, and their export as flat pieces to cut or print.
 * A size left empty is the one the drawing already uses.
 */
export function Build() {
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

  const units = shown?.compiled?.units;
  if (!shown || !units || !sizes) return null;
  const unit = docFactor(LENGTH, units);
  const problems = checkFabrication(sizes);
  const automatic = (size: number): string => `${formatNumber(size / unit, 3)} ${units.length}`;
  const stem = fileStem(shown.doc?.meta?.name);

  return (
    <section aria-label="Parts to make" className="border-rule border-t">
      <h2 className="border-rule border-b px-3 py-2 font-semibold">Parts to make</h2>
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
        </div>
      </div>
    </section>
  );
}
