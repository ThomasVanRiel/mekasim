import { writePath } from "@mekasim/core";
import { parseKey, type TouchGrid, tally } from "./grid.ts";
import type { Part } from "./parts.ts";

/** mekasim's light paper and inks, as in `packages/ui/src/theme.ts`. */
const PAPER = "#edf1ea";
const INK = "#20282d";
const INK_SOFT = "#5a666d";
const BODY = "#6f8ea8";
const DYE = "#2046c4";
const RED = "#c2362c";

const mm = (metres: number): string => Number((metres * 1000).toFixed(4)).toString();

/**
 * A picture of one part with where a study's runs touched it: a blue dot on each cell
 * passing runs touched, a red one on each that failing runs touched, over it, each the
 * darker the more runs did; a red ring where a run jammed. The dots are larger than
 * the cells, so that they show beside the outline. In millimetres, the part's own
 * frame, y up. `runs` gives how many runs passed and failed, for the caption.
 */
export function touchSvg(
  part: Part,
  grid: TouchGrid,
  runs: { passed: number; failed: number },
): string {
  const { bounds } = part.shape;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const margin = extent * 0.06;
  const caption = extent * 0.1;
  const minX = bounds.minX - margin;
  const maxY = bounds.maxY + margin;
  const width = bounds.maxX - bounds.minX + 2 * margin;
  const height = bounds.maxY - bounds.minY + 2 * margin + caption;

  let mostPassed = 0;
  let mostFailed = 0;
  for (const cell of grid.cells.values()) {
    mostPassed = Math.max(mostPassed, cell.passed);
    mostFailed = Math.max(mostFailed, cell.failed);
  }
  const size = grid.size;
  const dot = Math.max(size * 0.75, extent * 0.006);
  const centre = (key: string): [number, number] => {
    const [i, j] = parseKey(key);
    return [(i + 0.5) * size, (j + 0.5) * size];
  };
  const mark = (key: string, colour: string, share: number): string => {
    const [x, y] = centre(key);
    const opacity = Number((0.25 + 0.75 * share).toFixed(3));
    return `<circle cx="${x}" cy="${y}" r="${dot}" fill="${colour}" fill-opacity="${opacity}"/>`;
  };
  const passed: string[] = [];
  const failed: string[] = [];
  const jammed: string[] = [];
  for (const [key, cell] of grid.cells) {
    if (cell.passed > 0) passed.push(mark(key, DYE, cell.passed / mostPassed));
    if (cell.failed > 0) failed.push(mark(key, RED, cell.failed / mostFailed));
    if (cell.jammed > 0) {
      const [x, y] = centre(key);
      jammed.push(
        `<circle cx="${x}" cy="${y}" r="${dot * 3}" fill="none" stroke="${RED}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
      );
    }
  }
  const { onlyFailed, both, onlyPassed } = tally(grid);
  const also = part.bodies.length > 1 ? ` (also ${part.bodies.slice(1).join(", ")})` : "";
  const lines = [
    `${part.name}${also}: where ${runs.passed} passing and ${runs.failed} failing runs touched it`,
    `${onlyFailed} cells touched only in failing runs, ${both} in both, ${onlyPassed} only in passing ones; cells of ${mm(size)} mm`,
  ];
  // A monospaced letter is about 0.6 of its size wide: the longest line fits the width.
  const longest = Math.max(...lines.map((line) => line.length));
  const font = Math.min(caption * 0.3, (width - margin * 0.6) / (0.62 * longest));
  const text = lines
    .map(
      (line, n) =>
        `<text x="${mm(minX + margin * 0.3)}" y="${mm(-(bounds.minY - margin) + caption * 0.4 + font * 1.5 * n)}" font-family="IBM Plex Mono, monospace" font-size="${mm(font)}" fill="${n === 0 ? INK : INK_SOFT}">${escaped(line)}</text>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mm(minX)} ${mm(-maxY)} ${mm(width)} ${mm(height)}" width="${mm(width)}mm" height="${mm(height)}mm">
<rect x="${mm(minX)}" y="${mm(-maxY)}" width="${mm(width)}" height="${mm(height)}" fill="${PAPER}"/>
<g transform="scale(1000 -1000)">
<path d="${writePath([part.shape.outer, ...part.shape.holes], 9)}" fill="${BODY}" fill-opacity="0.35" fill-rule="evenodd" stroke="${INK}" stroke-width="1" vector-effect="non-scaling-stroke"/>
<g>${passed.join("")}</g>
<g>${failed.join("")}</g>
<g>${jammed.join("")}</g>
</g>
${text}
</svg>
`;
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
