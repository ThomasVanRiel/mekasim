import { useColors } from "@mekasim/ui";
import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { type OrthographicCamera, Vector3 } from "three";
import { type DraftPoint, useStore } from "../store.ts";
import { type Hit, pick } from "./pick.ts";
import {
  clickCam,
  clickCrank,
  clickGear,
  clickLink,
  clickMeasure,
  clickMotor,
  clickPin,
  clickRod,
  clickSlot,
  clickTie,
  clickTrace,
  type Grab,
  grab,
  pull,
  type Reshape,
  release,
  reshapeTo,
  snap,
  startReshape,
} from "./tools.ts";

/** How near the pointer must be to a point or pin to count as on it, in pixels. */
const REACH_PX = 10;
/** Pointer travel below this is a click rather than a drag, in pixels. */
const CLICK_PX = 4;

interface Press {
  startX: number;
  startY: number;
  moved: boolean;
  hit?: Hit;
  held?: Grab;
  reshape?: Reshape;
  /** Moving the underlay: where the pointer and the picture were when it was taken hold of. */
  carry?: { x: number; y: number; originX: number; originY: number };
}

/** Tools whose clicks write points as they sit at the start of the motion. */
const DRAWN_AT_START = new Set([
  "link",
  "pin",
  "reshape",
  "crank",
  "rod",
  "slot",
  "tie",
  "gear",
  "cam",
]);
/** Tools that collect clicked places, shown as the tool is used. */
const COLLECTING = new Set([
  "link",
  "measure",
  "calibrate",
  "crank",
  "rod",
  "slot",
  "tie",
  "gear",
  "cam",
]);
/** Tools that show a line from the last place to the pointer while drawing. */
const RUBBER_BAND = new Set(["link", "crank", "rod", "slot", "tie"]);

function ring(x: number, y: number, z: number, radius: number): [number, number, number][] {
  return Array.from({ length: 33 }, (_, k) => {
    const angle = (2 * Math.PI * k) / 32;
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle), z];
  });
}

/**
 * Turns pointer input on the flat sheet into tool actions, and draws the link that
 * is being placed. Works in the 2D view only, where a screen position is a position
 * on the sheet.
 */
export function Interaction() {
  const colors = useColors();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const scene = useStore((s) => s.scene);
  const draft = useStore((s) => s.draft);
  const tool = useStore((s) => s.tool);
  const [cursor, setCursor] = useState<DraftPoint>();

  useEffect(() => {
    const canvas = gl.domElement;
    const host = canvas.parentElement ?? canvas;
    const corner = new Vector3();
    let press: Press | undefined;

    /** The pointer's place on the sheet in metres, and the click reach there. */
    function locate(event: PointerEvent): { x: number; y: number; reach: number } {
      const box = canvas.getBoundingClientRect();
      corner
        .set(
          ((event.clientX - box.left) / box.width) * 2 - 1,
          1 - ((event.clientY - box.top) / box.height) * 2,
          0,
        )
        .unproject(camera);
      return { x: corner.x, y: corner.y, reach: REACH_PX / camera.zoom };
    }

    function onDown(event: PointerEvent): void {
      const state = useStore.getState();
      if (event.button !== 0 || event.target !== canvas || state.view !== "2d" || !state.scene)
        return;
      if (DRAWN_AT_START.has(state.tool) && (state.playing || state.step !== 0)) {
        // Points are written as they sit at the start of the motion, so draw there.
        state.setPlaying(false);
        state.setStep(0);
        state.setNotice(
          "Drawing happens at the starting position, so the motion was put back there. Click again.",
        );
        return;
      }
      const { x, y, reach } = locate(event);
      press = { startX: event.clientX, startY: event.clientY, moved: false };

      if (state.tool === "select") {
        press.hit = pick(state.scene, state.step, x, y, reach);
        if (press.hit) press.held = grab(state.scene, press.hit, x, y);
      } else if (state.tool === "reshape") {
        press.reshape = startReshape(state.scene, x, y, reach);
      } else if (state.tool === "link") {
        clickLink(snap(state.scene, x, y, reach, event.altKey), reach);
      } else if (state.tool === "pin") {
        clickPin(state.scene, x, y, reach);
      } else if (state.tool === "motor") {
        clickMotor(state.scene, x, y, reach);
      } else if (state.tool === "trace") {
        clickTrace(state.scene, x, y, reach);
      } else if (state.tool === "measure") {
        clickMeasure(state.scene, x, y, reach);
      } else if (state.tool === "crank") {
        clickCrank(snap(state.scene, x, y, reach, event.altKey), reach);
      } else if (state.tool === "rod") {
        clickRod(state.scene, x, y, reach);
      } else if (state.tool === "slot") {
        clickSlot(state.scene, snap(state.scene, x, y, reach, event.altKey), reach);
      } else if (state.tool === "tie") {
        clickTie(state.scene, x, y, reach);
      } else if (state.tool === "gear") {
        clickGear(state.scene, x, y, reach);
      } else if (state.tool === "cam") {
        clickCam(state.scene, x, y, reach);
      } else if (state.tool === "calibrate") {
        // Two places on the picture; a third click starts over.
        state.setDraft(state.draft.length >= 2 ? [{ x, y }] : [...state.draft, { x, y }]);
      } else if (state.tool === "place" && state.underlay) {
        press.carry = { x, y, originX: state.underlay.x, originY: state.underlay.y };
      }
      // Holding a part must not also pan the sheet.
      if (controls && (press.held || press.reshape || press.carry)) controls.enabled = false;
    }

    function onMove(event: PointerEvent): void {
      const state = useStore.getState();
      if (!state.scene || state.view !== "2d") return;
      const { x, y, reach } = locate(event);

      if (RUBBER_BAND.has(state.tool) && event.target === canvas) {
        setCursor(snap(state.scene, x, y, reach, event.altKey));
      }
      if (!press) return;
      const travel = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (!press.moved && travel < CLICK_PX) return;
      press.moved = true;
      if (press.carry && state.underlay) {
        state.setUnderlay({
          ...state.underlay,
          x: press.carry.originX + x - press.carry.x,
          y: press.carry.originY + y - press.carry.y,
        });
      } else if (press.held) pull(state.scene, press.held, x, y);
      else if (press.reshape) {
        const to = snap(state.scene, x, y, 0, event.altKey);
        reshapeTo(press.reshape, to.x, to.y);
      }
    }

    function onUp(): void {
      if (!press) return;
      const state = useStore.getState();
      if (controls) controls.enabled = true;
      if (press.held && press.moved && state.scene) release(state.scene, press.held);
      // A click on the sheet selects what is under it, or nothing.
      if (!press.moved && state.tool === "select") state.select(press.hit);
      press = undefined;
    }

    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (controls) controls.enabled = true;
    };
  }, [gl, camera, controls]);

  useEffect(() => {
    gl.domElement.style.cursor = tool === "select" ? "" : "crosshair";
    if (!RUBBER_BAND.has(tool)) setCursor(undefined);
  }, [gl, tool]);

  if (!scene || !COLLECTING.has(tool)) return null;
  const z = scene.depth + scene.sizes.pitch;
  // Once a first place is set, a line follows the pointer to where the next would go.
  const banded = cursor && RUBBER_BAND.has(tool) && (tool === "link" || draft.length > 0);
  const path = banded ? [...draft, cursor] : draft;
  return (
    <>
      {path.length > 1 && (
        <Line points={path.map((p) => [p.x, p.y, z])} color={colors.dye} lineWidth={2.5} />
      )}
      {path.map((p, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: draft points have no identity beyond their order
          key={i}
          points={ring(p.x, p.y, z, scene.sizes.half * (p.ref ? 0.9 : 0.4))}
          color={p.ref ? colors.brass : colors.dye}
          lineWidth={p.ref ? 3 : 2}
        />
      ))}
    </>
  );
}
