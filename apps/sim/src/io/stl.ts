import type { Part } from "@mekasim/core";
import { Group, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { plate } from "./plate.ts";

/**
 * Parts as one binary STL, all in one solid: each part as a flat plate of the
 * given thickness, lying on the print bed as laid out.
 * Sizes in, metres; sizes out, millimetres.
 */
export function toStl(parts: Part[], thickness: number): ArrayBuffer {
  const group = new Group();
  for (const part of parts) group.add(new Mesh(plate(part, thickness)));
  const data = new STLExporter().parse(group, { binary: true });
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
