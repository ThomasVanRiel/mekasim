import { docFactor, formatQuantity, LENGTH } from "@mekasim/core";
import { label } from "@mekasim/ui";
import type { ReactNode } from "react";
import { useStore } from "../store.ts";

function Cell({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`border-ink border-t border-l px-2 py-1 ${wide ? "col-span-3" : ""}`}>
      <dt className="text-[11px] text-ink-soft leading-tight">{label}</dt>
      <dd className="leading-tight">{children}</dd>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The corner block of a drawing sheet, carrying the facts about the model. */
export function TitleBlock() {
  const shown = useStore((s) => s.shown);
  const scene = useStore((s) => s.scene);
  const compiled = shown?.compiled;
  if (!shown || !compiled || !scene) return null;

  const { mobility, cycle } = shown;
  const { units } = compiled;
  const bodies = compiled.model.bodies.length;
  const driver = compiled.drivers[0];
  let freedom = "Not assembled";
  if (mobility) {
    freedom =
      mobility.free === 0
        ? `${plural(mobility.mobility, "degree")} of freedom, all driven`
        : `${plural(mobility.free, "degree")} of freedom left undriven`;
  }
  const gridStep = Number((scene.gridStep / docFactor(LENGTH, units)).toPrecision(3));

  return (
    <dl className="pointer-events-none absolute right-3 bottom-3 hidden max-w-[min(26rem,calc(100%-1.5rem))] grid-cols-3 border-ink border-r border-b bg-paper/90 text-sm lg:grid">
      <Cell label="Model" wide>
        <span className="font-semibold">{shown.doc?.meta?.name ?? "Untitled model"}</span>
      </Cell>
      <Cell label="Parts">
        {bodies} moving {bodies === 1 ? "body" : "bodies"},{" "}
        {plural(compiled.joints.length, "joint")}
      </Cell>
      <Cell label="Freedom">{freedom}</Cell>
      <Cell label="Cycle">
        {compiled.period > 0 && cycle
          ? `${formatQuantity(compiled.period, [0, 1, 0, 0], units, 4)}, ${cycle.count} steps`
          : "Not driven"}
      </Cell>
      <Cell label="Units">
        {units.length}, {units.angle}
      </Cell>
      <Cell label="Grid">
        {gridStep} {units.length}, heavy lines every {gridStep * 5}
      </Cell>
      <Cell label="Driver">
        {driver
          ? `${label(driver.id)}, ${Number(((driver.speed * 60) / (2 * Math.PI)).toPrecision(4))} rpm`
          : "None"}
      </Cell>
    </dl>
  );
}
