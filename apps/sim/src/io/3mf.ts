import type { Part } from "@mekasim/core";
import { plate } from "./plate.ts";
import { zip } from "./zip.ts";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** A size in millimetres as written in the file: to a tenth of a micrometre. */
function number(value: number): string {
  const text = value.toFixed(4).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A part's plate as the mesh of a 3MF object: every corner written once and the
 * triangles pointing to them, so that a printing program finds it closed.
 */
function mesh(part: Part, thickness: number): string {
  const geometry = plate(part, thickness);
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const vertices: string[] = [];
  const known = new Map<string, number>();
  const corners: number[] = [];
  for (let i = 0; i < (index ? index.count : position.count); i++) {
    const at = index ? index.getX(i) : i;
    const vertex = `<vertex x="${number(position.getX(at))}" y="${number(position.getY(at))}" z="${number(position.getZ(at))}"/>`;
    let id = known.get(vertex);
    if (id === undefined) {
      id = vertices.length;
      known.set(vertex, id);
      vertices.push(vertex);
    }
    corners.push(id);
  }
  geometry.dispose();
  const triangles: string[] = [];
  for (let i = 0; i < corners.length; i += 3) {
    const [a, b, c] = [corners[i], corners[i + 1], corners[i + 2]];
    // A triangle whose corners fell together has no area to print.
    if (a === b || b === c || c === a) continue;
    triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return `<mesh>\n<vertices>\n${vertices.join("\n")}\n</vertices>\n<triangles>\n${triangles.join("\n")}\n</triangles>\n</mesh>`;
}

/**
 * Parts as a 3MF file, each an object of its own under its name: flat plates of
 * the given thickness, lying on the print bed as laid out. A printing program
 * can then move, turn, copy or leave out one piece without the others.
 * Sizes in, metres; sizes out, millimetres.
 */
export function to3mf(
  parts: Part[],
  thickness: number,
  names: (id: string) => string = (id) => id,
): ArrayBuffer {
  const objects = parts.map(
    (part, i) =>
      `<object id="${i + 1}" type="model" name="${escapeXml(names(part.id))}">\n${mesh(part, thickness)}\n</object>`,
  );
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
${objects.join("\n")}
</resources>
<build>
${items.join("\n")}
</build>
</model>
`;
  return zip([
    { path: "[Content_Types].xml", text: CONTENT_TYPES },
    { path: "_rels/.rels", text: RELATIONSHIPS },
    { path: "3D/3dmodel.model", text: model },
  ]);
}
