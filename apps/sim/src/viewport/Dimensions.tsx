import { formatQuantity, LENGTH, type MeasuredGap } from "@mekasim/core";
import type { Scene } from "@mekasim/ui";
import { label, useColors } from "@mekasim/ui";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { LineSegments2 } from "three-stdlib";
import { useStore } from "../store.ts";
import { toWorld } from "./pick.ts";

const NO_GAPS: MeasuredGap[] = [];

const TEXT_CLASS =
  "absolute top-0 left-0 whitespace-nowrap text-[12px] text-ink leading-none tabular-nums";
/** A paper-coloured edge keeps the lettering readable over lines and plates. */
const HALO = "0 0 2px var(--color-paper), 0 0 2px var(--color-paper), 0 0 4px var(--color-paper)";

type Place = readonly [number, number];

/**
 * The measured distances and gaps, each as a dashed line between its two places with a tick
 * at either end, and its name and present value written at the middle. Lines and
 * values follow the motion.
 */
export function Dimensions({ scene }: { scene: Scene }) {
  const colors = useColors();
  const gaps = useStore((s) => s.shown?.gaps) ?? NO_GAPS;
  const count = scene.dimensions.length + gaps.length;
  const gl = useThree((s) => s.gl);
  const units = useStore((s) => s.shown?.compiled?.units);
  const lines = useRef<LineSegments2>(null);
  const ticks = useRef<LineSegments2>(null);
  const spans = useRef<HTMLSpanElement[]>([]);
  const projected = useRef(new Vector3());
  // In front of every plate and pin, so that no link hides a distance.
  const z = scene.depth + scene.sizes.thickness;
  const tick = scene.sizes.half * 0.6;

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const layer = document.createElement("div");
    layer.className = "pointer-events-none absolute inset-0 overflow-hidden";
    layer.setAttribute("aria-hidden", "true");
    spans.current = Array.from({ length: count }, () => {
      const span = document.createElement("span");
      span.className = TEXT_CLASS;
      span.style.textShadow = HALO;
      layer.append(span);
      return span;
    });
    parent.append(layer);
    return () => {
      layer.remove();
      spans.current = [];
    };
  }, [gl, count]);

  useFrame(({ camera, size }) => {
    const { step } = useStore.getState();
    const runs: number[] = [];
    const ends: number[] = [];
    /** One distance: its line, its ticks, and its value at the middle. */
    const draw = (i: number, [ax, ay]: Place, [bx, by]: Place, name: string, value?: number) => {
      const length = Math.hypot(bx - ax, by - ay);
      // The ticks stand square to the line.
      const nx = length > 0 ? (-(by - ay) / length) * tick : 0;
      const ny = length > 0 ? ((bx - ax) / length) * tick : tick;
      runs.push(ax, ay, z, bx, by, z);
      ends.push(ax - nx, ay - ny, z, ax + nx, ay + ny, z);
      ends.push(bx - nx, by - ny, z, bx + nx, by + ny, z);

      const span = spans.current[i];
      if (!span || !units) return;
      const text = `${name} ${formatQuantity(value ?? length, LENGTH, units, 4)}`;
      if (span.textContent !== text) span.textContent = text;
      const at = projected.current.set((ax + bx) / 2, (ay + by) / 2, z).project(camera);
      const px = ((at.x + 1) / 2) * size.width;
      const py = ((1 - at.y) / 2) * size.height;
      span.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    };
    scene.dimensions.forEach((dimension, i) => {
      draw(
        i,
        toWorld(scene, dimension.a.body, step, dimension.a.u, dimension.a.v),
        toWorld(scene, dimension.b.body, step, dimension.b.u, dimension.b.v),
        dimension.text,
      );
    });
    // The gaps between shapes, each between its two nearest places at this step.
    gaps.forEach((found, i) => {
      const at = found.gaps[Math.min(found.gaps.length - 1, Math.round(step))];
      if (!at) return;
      draw(
        scene.dimensions.length + i,
        at.a,
        at.b,
        `${label(found.a)} to ${label(found.b)}`,
        at.distance,
      );
    });
    lines.current?.geometry.setPositions(runs);
    lines.current?.computeLineDistances();
    ticks.current?.geometry.setPositions(ends);
  });

  // The points given here only size the lines; the frame loop sets the real ones.
  const blank = (perDimension: number): [number, number, number][] =>
    Array.from({ length: perDimension * count }, () => [0, 0, 0]);
  return (
    <>
      <Line
        ref={lines}
        points={blank(2)}
        segments
        color={colors.ink}
        lineWidth={1}
        dashed
        dashSize={scene.sizes.half * 0.6}
        gapSize={scene.sizes.half * 0.4}
      />
      <Line ref={ticks} points={blank(4)} segments color={colors.ink} lineWidth={1} />
    </>
  );
}
