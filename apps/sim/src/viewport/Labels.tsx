import { poseAt, type Scene, spacePoseAt } from "@mekasim/ui";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3 } from "three";
import { useStore } from "../store.ts";

const POINT_CLASS =
  "absolute top-0 left-0 whitespace-nowrap font-medium text-[12px] text-ink leading-none";
const BODY_CLASS =
  "absolute top-0 left-0 whitespace-nowrap text-[12px] text-ink-soft italic leading-none";
/** A paper-coloured edge keeps the lettering readable over lines and plates. */
const HALO = "0 0 2px var(--color-paper), 0 0 2px var(--color-paper), 0 0 4px var(--color-paper)";

/**
 * Names of points and bodies, as ordinary text laid over the drawing so that it
 * stays sharp at any zoom. Each frame the text is moved to where its point is.
 */
export function Labels({ scene }: { scene: Scene }) {
  const gl = useThree((s) => s.gl);
  const spans = useRef<HTMLSpanElement[]>([]);
  const pose = useRef<[number, number, number]>([0, 0, 0]);
  const projected = useRef(new Vector3());
  const turned = useRef(new Quaternion());
  const spacePose = useRef(new Float64Array(7));
  /** The labels of bodies in space, after those on the sheet. */
  const spaceLabels = useMemo(
    () =>
      (scene.space?.bodies ?? []).flatMap((body) =>
        body.labels.map((label) => ({ ...label, of: body })),
      ),
    [scene.space],
  );

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const layer = document.createElement("div");
    layer.className = "pointer-events-none absolute inset-0 overflow-hidden";
    layer.setAttribute("aria-hidden", "true");
    spans.current = [...scene.labels, ...spaceLabels].map((label) => {
      const span = document.createElement("span");
      span.textContent = label.text;
      span.className = label.body ? BODY_CLASS : POINT_CLASS;
      span.style.textShadow = HALO;
      layer.append(span);
      return span;
    });
    parent.append(layer);
    return () => {
      layer.remove();
      spans.current = [];
    };
  }, [gl, scene.labels, spaceLabels]);

  useFrame(({ camera, size }) => {
    const { step } = useStore.getState();
    /** Where a span goes for a place in the world. */
    const put = (span: HTMLSpanElement, at: Vector3, body: boolean): void => {
      at.project(camera);
      const px = ((at.x + 1) / 2) * size.width;
      const py = ((1 - at.y) / 2) * size.height;
      // Point names sit up and to the right of the point; body names are centred on the body.
      span.style.transform = body
        ? `translate(${px}px, ${py}px) translate(-50%, -50%)`
        : `translate(${px + 7}px, ${py - 17}px)`;
    };
    spaceLabels.forEach((label, i) => {
      const span = spans.current[scene.labels.length + i];
      if (!span) return;
      spacePoseAt(label.of, step, scene.periodic, spacePose.current);
      const p = spacePose.current;
      turned.current.set(p[3] as number, p[4] as number, p[5] as number, p[6] as number);
      const at = projected.current
        .set(...label.s)
        .applyQuaternion(turned.current)
        .add({ x: p[0] as number, y: p[1] as number, z: p[2] as number } as Vector3);
      put(span, at, label.body);
    });
    scene.labels.forEach((label, i) => {
      const span = spans.current[i];
      if (!span) return;
      let x = label.u;
      let y = label.v;
      if (label.carrier >= 0) {
        poseAt(scene, label.carrier, step, pose.current);
        const c = Math.cos(pose.current[2]);
        const s = Math.sin(pose.current[2]);
        x = pose.current[0] + label.u * c - label.v * s;
        y = pose.current[1] + label.u * s + label.v * c;
      }
      put(span, projected.current.set(x, y, label.z), label.body);
    });
  });

  return null;
}
