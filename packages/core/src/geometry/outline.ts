export type Point = [x: number, y: number];

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull, counter-clockwise, without collinear points. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter((p, i) => {
    const previous = sorted[i - 1];
    return !previous || previous[0] !== p[0] || previous[1] !== p[1];
  });
  if (unique.length < 3) return unique;

  // Points within this distance of an edge are treated as on it.
  const size = Math.hypot(
    (unique.at(-1) as Point)[0] - (unique[0] as Point)[0],
    Math.max(...unique.map((p) => p[1])) - Math.min(...unique.map((p) => p[1])),
  );
  const slack = size * size * 1e-9;

  const half = (input: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of input) {
      while (chain.length >= 2 && cross(chain.at(-2) as Point, chain.at(-1) as Point, p) <= slack) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(unique), ...half([...unique].reverse())];
}

/**
 * Outline of a plate that covers all the given points with a margin of `radius`:
 * the convex hull grown outwards with rounded corners. Two points give a link with
 * round ends, one point a disc.
 */
export function plateOutline(points: Point[], radius: number, segmentsPerTurn = 48): Point[] {
  const hull = convexHull(points);
  const outline: Point[] = [];
  if (hull.length === 0) return outline;

  hull.forEach((vertex, i) => {
    const previous = hull.at(i - 1) as Point;
    const next = hull[(i + 1) % hull.length] as Point;
    // Sweep the corner from the outward normal of the incoming edge to that of the outgoing one.
    let start = 0;
    let sweep = 2 * Math.PI;
    if (hull.length > 1) {
      start = Math.atan2(-(vertex[0] - previous[0]), vertex[1] - previous[1]);
      const end = Math.atan2(-(next[0] - vertex[0]), next[1] - vertex[1]);
      sweep = (((end - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    }
    const steps = Math.max(1, Math.ceil((sweep / (2 * Math.PI)) * segmentsPerTurn));
    for (let k = hull.length > 1 ? 0 : 1; k <= steps; k++) {
      const angle = start + (sweep * k) / steps;
      outline.push([vertex[0] + radius * Math.cos(angle), vertex[1] + radius * Math.sin(angle)]);
    }
  });
  return outline;
}
