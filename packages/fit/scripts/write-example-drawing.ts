// Writes examples/fit/four-bar-links.dxf: the links of mekasim's shaped four-bar, laid
// out side by side as on a sheet to cut, each on a layer of its own. It stands for a
// drawing that comes out of a CAD program, for the example that takes its shapes from it.
import { readFileSync, writeFileSync } from "node:fs";
import { placeShape, simulate } from "@mekasim/core";
import { shapesToDxf } from "../src/export/dxf.ts";

const model = readFileSync(
  new URL("../../../examples/shaped-four-bar.mekasim.yaml", import.meta.url),
  "utf8",
);
const { compiled } = simulate(model);
if (!compiled) throw new Error("The shaped four-bar does not compile");

/** Where each link's own frame sits on the sheet, in metres and radians. */
const LAYOUT: Record<string, { layer: string; x: number; y: number; angle: number }> = {
  crank: { layer: "CRANK", x: 0.02, y: 0.02, angle: 0 },
  coupler: { layer: "COUPLER", x: 0.02, y: 0.06, angle: 0 },
  rocker: { layer: "ROCKER", x: 0.03, y: 0.15, angle: (15 * Math.PI) / 180 },
};

const drawn = Object.entries(LAYOUT).map(([id, { layer, ...place }]) => {
  const shape = compiled.bodies.get(id)?.shape;
  if (!shape) throw new Error(`"${id}" has no shape`);
  return { layer, shape: placeShape(shape, place) };
});

const target = new URL("../../../examples/fit/four-bar-links.dxf", import.meta.url);
writeFileSync(target, shapesToDxf(drawn, "mm"));
console.log(`Wrote ${target.pathname}`);
