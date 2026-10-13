/**
 * The coordinates a motion is plotted and measured in: along x and y or as a radius
 * and an angle, on the sheet or as seen from a frame of the model. The choice only
 * decides which expressions are written into the model; the model itself says the rest.
 */
export interface Coordinates {
  /** The frame to see the motion from; the sheet when left out. */
  frame?: string;
  polar: boolean;
}

export const SHEET: Coordinates = { polar: false };

export interface PlotChoice {
  label: string;
  name: string;
  series: string[];
}

export interface MeasureChoice {
  label: string;
  items: [name: string, expr: string][];
}

/** A function of a point or a link, seen from the frame when there is one. */
function call(fn: string, ref: string, { frame }: Coordinates): string {
  return frame === undefined ? `${fn}(${ref})` : `${fn}(${ref}, ${frame})`;
}

function inFrame({ frame }: Coordinates): string {
  return frame === undefined ? "" : `_in_${frame}`;
}

/**
 * The charts of the motion of a point or a link: where it is, and its speed,
 * acceleration and jerk, each as its two signed parts and its size. `base` starts
 * the names of the charts.
 */
export function motionPlots(ref: string, base: string, coordinates: Coordinates): PlotChoice[] {
  const { polar } = coordinates;
  const end = `${polar ? "_polar" : ""}${inFrame(coordinates)}`;
  const [first, second] = polar ? ["r", "t"] : ["x", "y"];
  const vector = (fn: string): string[] =>
    [`${fn}${first}`, `${fn}${second}`, fn].map((name) => call(name, ref, coordinates));
  return [
    polar
      ? {
          label: "position",
          name: `${base}_position${end}`,
          series: [call("r", ref, coordinates), call("theta", ref, coordinates)],
        }
      : {
          label: "movement",
          name: `${base}_movement${end}`,
          series: [
            `change(${call("x", ref, coordinates)})`,
            `change(${call("y", ref, coordinates)})`,
            call("moved", ref, coordinates),
          ],
        },
    { label: "speed", name: `${base}_speed${end}`, series: vector("v") },
    { label: "acceleration", name: `${base}_accel${end}`, series: vector("a") },
    { label: "jerk", name: `${base}_jerk${end}`, series: vector("j") },
  ];
}

/** The measures of where a point or a link is, in the same coordinates. */
export function positionMeasures(
  ref: string,
  base: string,
  coordinates: Coordinates,
): MeasureChoice {
  const end = inFrame(coordinates);
  if (coordinates.polar) {
    return {
      label: "position",
      items: [
        [`${base}_r${end}`, call("r", ref, coordinates)],
        [`${base}_theta${end}`, call("theta", ref, coordinates)],
      ],
    };
  }
  return {
    label: "movement",
    items: [
      [`${base}_dx${end}`, `change(${call("x", ref, coordinates)})`],
      [`${base}_dy${end}`, `change(${call("y", ref, coordinates)})`],
      [`${base}_moved${end}`, call("moved", ref, coordinates)],
    ],
  };
}

/** The measure of how fast a point or a link goes, as seen in the same coordinates. */
export function speedMeasure(ref: string, base: string, coordinates: Coordinates): MeasureChoice {
  return {
    label: "speed",
    items: [[`${base}_speed${inFrame(coordinates)}`, call("v", ref, coordinates)]],
  };
}
