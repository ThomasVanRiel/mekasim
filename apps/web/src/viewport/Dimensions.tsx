import { formatQuantity, LENGTH } from "@mekasim/core";
import { useColors } from "@mekasim/ui";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { LineSegments2 } from "three-stdlib";
import { useStore } from "../store.ts";
import { toWorld } from "./pick.ts";
import type { Scene } from "./scene.ts";

const TEXT_CLASS =
  "absolute top-0 left-0 whitespace-nowrap text-[12px] text-ink leading-none tabular-nums";
/** A paper-coloured edge keeps the lettering readable over lines and plates. */
const HALO = "0 0 2px var(--color-paper), 0 0 2px var(--color-paper), 0 0 4px var(--color-paper)";

/**
 * The measured distances, each as a dashed line between its two places with a tick
 * at either end, and its name and present value written at the middle. Lines and
 * values follow the motion.
 */
export function Dimensions({ scene }: { scene: Scene }) {
  const colors = useColors();
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
    spans.current = scene.dimensions.map(() => {
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
  }, [gl, scene.dimensions]);

  useFrame(({ camera, size }) => {
    const { step } = useStore.getState();
    const runs: number[] = [];
    const ends: number[] = [];
    scene.dimensions.forEach((dimension, i) => {
      const [ax, ay] = toWorld(scene, dimension.a.body, step, dimension.a.u, dimension.a.v);
      const [bx, by] = toWorld(scene, dimension.b.body, step, dimension.b.u, dimension.b.v);
      const length = Math.hypot(bx - ax, by - ay);
      // The ticks stand square to the line.
      const nx = length > 0 ? (-(by - ay) / length) * tick : 0;
      const ny = length > 0 ? ((bx - ax) / length) * tick : tick;
      runs.push(ax, ay, z, bx, by, z);
      ends.push(ax - nx, ay - ny, z, ax + nx, ay + ny, z);
      ends.push(bx - nx, by - ny, z, bx + nx, by + ny, z);

      const span = spans.current[i];
      if (!span || !units) return;
      const text = `${dimension.text} ${formatQuantity(length, LENGTH, units, 4)}`;
      if (span.textContent !== text) span.textContent = text;
      const at = projected.current.set((ax + bx) / 2, (ay + by) / 2, z).project(camera);
      const px = ((at.x + 1) / 2) * size.width;
      const py = ((1 - at.y) / 2) * size.height;
      span.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    });
    lines.current?.geometry.setPositions(runs);
    lines.current?.computeLineDistances();
    ticks.current?.geometry.setPositions(ends);
  });

  // The points given here only size the lines; the frame loop sets the real ones.
  const blank = (perDimension: number): [number, number, number][] =>
    Array.from({ length: perDimension * scene.dimensions.length }, () => [0, 0, 0]);
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
