import { formatQuantity, type MeasuredGap, type Shape, type Units, writePath } from "@mekasim/core";
import {
  bodyColor,
  type Palette,
  poseAt,
  type Scene,
  SheetDimension,
  SheetLabel,
  useColors,
} from "@mekasim/ui";
import { type ReactNode, useMemo } from "react";

type Pose = [x: number, y: number, angle: number];

/** Where each moving body is at a step of the run. */
function posesAt(scene: Scene, step: number): Pose[] {
  const count = scene.cycle.width / 3;
  return Array.from({ length: count }, (_, body) => {
    const pose: Pose = [0, 0, 0];
    poseAt(scene, body, step, pose);
    return pose;
  });
}

/** A place on a body, in the world. The ground, body -1, does not move. */
function placed(poses: Pose[], body: number, u: number, v: number): [number, number] {
  const pose = poses[body];
  if (!pose) return [u, v];
  const [x, y, angle] = pose;
  return [
    x + u * Math.cos(angle) - v * Math.sin(angle),
    y + u * Math.sin(angle) + v * Math.cos(angle),
  ];
}

/** What is drawn on a body moves and turns with it. */
function On({ poses, body, children }: { poses: Pose[]; body: number; children: ReactNode }) {
  const pose = poses[body];
  if (!pose) return <g>{children}</g>;
  return (
    <g transform={`translate(${pose[0]} ${pose[1]}) rotate(${(pose[2] * 180) / Math.PI})`}>
      {children}
    </g>
  );
}

const path = (points: [number, number][]): string =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("");

/** Lines keep their width on the screen however far the sheet is zoomed. */
const LINE = { vectorEffect: "non-scaling-stroke", strokeWidth: 1.25 } as const;

/**
 * The mechanism at a step of the run, in world coordinates, for inside a `Sheet`:
 * the plates mekasim draws, their pins and slots, wheels, cams and traces.
 */
export function Drawing({
  scene,
  step,
  tool = "select",
  contactDraft,
  locks = [],
  onBody,
}: {
  scene: Scene;
  step: number;
  tool?: "select" | "contact";
  contactDraft?: string;
  /** The locks at this step, each on its joint: drawn as a small marker, filled when in. */
  locks?: { id: string; joint: string; in: boolean }[];
  onBody?(body: string): void;
}) {
  const colors: Palette = useColors();
  // An outline and its holes as one path, filled where it is material.
  const outlines = useMemo(() => {
    const d = (shape: Shape): string => writePath([shape.outer, ...shape.holes]);
    const found = new Map(
      scene.bodies.flatMap((body) => (body.shape ? [[body.id, d(body.shape)] as const] : [])),
    );
    if (scene.groundShape) found.set("ground", d(scene.groundShape));
    return found;
  }, [scene]);
  const poses = posesAt(scene, step);
  // Drawn from the back to the front, as the layers lie.
  const bodies = [...scene.bodies].sort((a, b) => a.z - b.z);

  const ground = outlines.get("ground");

  return (
    <>
      {/* What stands still lies under everything that moves. */}
      {ground && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Contact is a pointer tool on the drawing.
        <path
          d={ground}
          fillRule="evenodd"
          fill={colors.gridMajor}
          fillOpacity={0.6}
          stroke={contactDraft === "ground" ? colors.dye : colors.ink}
          strokeLinejoin="round"
          className={tool === "contact" ? "cursor-crosshair" : undefined}
          onClick={() => tool === "contact" && onBody?.("ground")}
          {...LINE}
          strokeWidth={contactDraft === "ground" ? 2.5 : LINE.strokeWidth}
        />
      )}
      {scene.traces.map((trace) => (
        <path
          key={trace.ref}
          d={path(trace.points.map(([x, y]) => [x, y]))}
          fill="none"
          stroke={colors.dye}
          {...LINE}
          strokeWidth={1}
        />
      ))}
      {scene.supports.map(([x, y]) => (
        <circle
          key={`${x} ${y}`}
          cx={x}
          cy={y}
          r={scene.sizes.pin * 2.2}
          fill={colors.paper}
          stroke={colors.ink}
          {...LINE}
        />
      ))}
      {scene.axes.map((axis) => (
        <On key={axis.id} poses={poses} body={axis.body}>
          <line
            x1={axis.from[0]}
            y1={axis.from[1]}
            x2={axis.to[0]}
            y2={axis.to[1]}
            stroke={colors.inkSoft}
            strokeDasharray="6 4"
            {...LINE}
          />
        </On>
      ))}
      {bodies.map((body) => (
        <On key={body.id} poses={poses} body={body.index}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Contact is a pointer tool on the drawing. */}
          <path
            d={outlines.get(body.id) ?? `${path(body.outline)}Z`}
            fillRule="evenodd"
            fill={bodyColor(colors, body.index)}
            fillOpacity={0.85}
            stroke={contactDraft === body.id ? colors.dye : colors.ink}
            strokeLinejoin="round"
            className={tool === "contact" && body.shape ? "cursor-crosshair" : undefined}
            onClick={() => tool === "contact" && body.shape && onBody?.(body.id)}
            {...LINE}
            strokeWidth={contactDraft === body.id ? 2.5 : LINE.strokeWidth}
          />
        </On>
      ))}
      {scene.cams.map((cam) => (
        <On key={cam.id} poses={poses} body={cam.body}>
          <path
            d={`${path(cam.outline)}Z`}
            fill={colors.brass}
            fillOpacity={0.35}
            stroke={colors.ink}
            {...LINE}
          />
        </On>
      ))}
      {scene.wheels.map((wheel) => (
        <On key={wheel.id} poses={poses} body={wheel.body}>
          <circle
            cx={wheel.u}
            cy={wheel.v}
            r={wheel.radius}
            fill="none"
            stroke={colors.ink}
            {...LINE}
          />
          {/* A mark on the rim shows the wheel turning. */}
          <line
            x1={wheel.u}
            y1={wheel.v}
            x2={wheel.u + wheel.radius}
            y2={wheel.v}
            stroke={colors.inkSoft}
            {...LINE}
          />
        </On>
      ))}
      {scene.rollers.map((roller) => (
        <On key={roller.id} poses={poses} body={roller.body}>
          <circle
            cx={roller.u}
            cy={roller.v}
            r={roller.radius}
            fill={colors.paper}
            stroke={colors.ink}
            {...LINE}
          />
        </On>
      ))}
      {scene.ties.map((tie) => {
        const a = placed(poses, tie.a.body, tie.a.u, tie.a.v);
        const b = placed(poses, tie.b.body, tie.b.u, tie.b.v);
        return (
          <line
            key={tie.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={colors.inkSoft}
            strokeDasharray={tie.kind === "belt" ? undefined : "2 3"}
            {...LINE}
          />
        );
      })}
      {scene.pins.map((pin) => (
        <On key={pin.id} poses={poses} body={pin.body}>
          <circle
            cx={pin.u}
            cy={pin.v}
            r={pin.radius}
            fill={pin.driven ? colors.brass : colors.paper}
            stroke={colors.ink}
            {...LINE}
          />
        </On>
      ))}
      {locks.map((lock) => {
        const pin = scene.pins.find(({ id }) => id === lock.joint);
        if (!pin) return null;
        // A small square on its corner, on the joint the lock drops in behind.
        const half = pin.radius * 0.6;
        return (
          <On key={lock.id} poses={poses} body={pin.body}>
            <path
              d={`M${pin.u - half} ${pin.v}L${pin.u} ${pin.v - half}L${pin.u + half} ${pin.v}L${pin.u} ${pin.v + half}Z`}
              fill={lock.in ? colors.brass : colors.paper}
              stroke={colors.brass}
              {...LINE}
            >
              <title>{`${lock.id}: ${lock.in ? "in" : "out"}`}</title>
            </path>
          </On>
        );
      })}
    </>
  );
}

/** A gap as it is written beside its line: how wide, or how far the parts are into each other. */
export function gapText(distance: number, units: Units): string {
  const size = formatQuantity(Math.abs(distance), [1, 0, 0, 0], units, 4);
  return distance < 0 ? `${size} into each other` : size;
}

/** The names and the measured distances of the drawing, in pixels, for the overlay of a `Sheet`. */
export function Names({
  scene,
  step,
  gaps,
  units,
}: {
  scene: Scene;
  step: number;
  /** The gaps the model asks about, drawn where they are measured at this step. */
  gaps: MeasuredGap[];
  units: Units;
}) {
  const poses = posesAt(scene, step);
  return (
    <>
      {gaps.map(({ a, b, gaps: over }) => {
        const found = over[Math.min(over.length - 1, Math.round(step))];
        if (!found) return null;
        return (
          <SheetDimension
            key={`${a} ${b}`}
            from={found.a}
            to={found.b}
            text={gapText(found.distance, units)}
            wrong={found.distance < 0}
          />
        );
      })}
      {scene.dimensions.map((dimension) => (
        <SheetDimension
          key={dimension.id}
          from={placed(poses, dimension.a.body, dimension.a.u, dimension.a.v)}
          to={placed(poses, dimension.b.body, dimension.b.u, dimension.b.v)}
          text={dimension.text}
        />
      ))}
      {scene.labels.map((name) => {
        const [x, y] = placed(poses, name.carrier, name.u, name.v);
        return (
          <SheetLabel
            key={`${name.carrier} ${name.u} ${name.v} ${name.text}`}
            x={x}
            y={y}
            strong={name.body}
          >
            {name.text}
          </SheetLabel>
        );
      })}
    </>
  );
}
