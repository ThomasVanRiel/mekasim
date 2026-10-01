import type { Point } from "@mekasim/core";
import { GROUND } from "@mekasim/core";
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import {
  type Group,
  MOUSE,
  type OrthographicCamera,
  Shape,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TOUCH,
  Vector2,
  Vector3,
} from "three";
import { useStore } from "../store.ts";
import { COLORS } from "../theme.ts";
import { CamPlate, Roller, Tie, Wheel } from "./Extras.tsx";
import { Interaction } from "./Interaction.tsx";
import { Labels } from "./Labels.tsx";
import {
  type DrawAxis,
  type DrawBody,
  type DrawPin,
  type DrawPoint,
  poseAt,
  type Scene,
  type Sizes,
} from "./scene.ts";

type Vec3 = [number, number, number];

function circle(radius: number, z: number, segments = 40): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, k): Vec3 => {
    const angle = (2 * Math.PI * k) / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  });
}

function loop(outline: Point[], z: number): Vec3[] {
  const points = outline.map(([x, y]): Vec3 => [x, y, z]);
  if (points.length > 0) points.push(points[0] as Vec3);
  return points;
}

/** A ring that marks the selected thing. */
function Halo({ at, radius }: { at: Vec3; radius: number }) {
  return (
    <group position={at}>
      <Line points={circle(radius, 0)} color={COLORS.dye} lineWidth={3} />
    </group>
  );
}

function Plate({
  body,
  sizes,
  selected,
  selectedPoint,
  seeThrough,
}: {
  body: DrawBody;
  sizes: Sizes;
  selected: boolean;
  selectedPoint: string | undefined;
  /** Let a picture underneath show through, for tracing over it. */
  seeThrough: boolean;
}) {
  const shape = useMemo(
    () => new Shape(body.outline.map(([x, y]) => new Vector2(x, y))),
    [body.outline],
  );
  const front = body.z + sizes.thickness;
  const lift = sizes.thickness * 0.03;
  return (
    <>
      <mesh position-z={body.z}>
        <extrudeGeometry args={[shape, { depth: sizes.thickness, bevelEnabled: false }]} />
        <meshLambertMaterial
          key={seeThrough ? "see-through" : "solid"}
          color={body.color}
          transparent={seeThrough}
          opacity={seeThrough ? 0.5 : 1}
        />
      </mesh>
      <Line
        points={loop(body.outline, front + lift)}
        color={selected ? COLORS.dye : COLORS.ink}
        lineWidth={selected ? 3 : 1.4}
      />
      <Line points={loop(body.outline, body.z - lift)} color={COLORS.ink} lineWidth={1.4} />
      {body.points.map((p) => (
        <mesh key={p.name} position={[p.u, p.v, front + lift]}>
          <circleGeometry args={[sizes.half * 0.16, 16]} />
          <meshBasicMaterial color={COLORS.ink} />
        </mesh>
      ))}
      {body.points
        .filter((p) => p.name === selectedPoint)
        .map((p) => (
          <Halo key={p.name} at={[p.u, p.v, front + 2 * lift]} radius={sizes.half * 0.7} />
        ))}
    </>
  );
}

function Pin({ pin, sizes, selected }: { pin: DrawPin; sizes: Sizes; selected: boolean }) {
  const radius = sizes.pin;
  const length = pin.zFront - pin.zBack;
  const lift = sizes.thickness * 0.03;
  const square = radius * 1.5;
  return (
    <group position={[pin.u, pin.v, 0]}>
      <mesh position-z={(pin.zFront + pin.zBack) / 2} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[radius, radius, length, 28]} />
        <meshLambertMaterial color={COLORS.brass} />
      </mesh>
      <Line points={circle(radius, pin.zFront + lift)} color={COLORS.ink} lineWidth={1.2} />
      {(pin.kind === "weld" || pin.kind === "slider") && (
        // A square around the pin marks a joint that does not let the bodies turn.
        <Line
          points={[
            [-square, -square, pin.zFront + lift],
            [square, -square, pin.zFront + lift],
            [square, square, pin.zFront + lift],
            [-square, square, pin.zFront + lift],
            [-square, -square, pin.zFront + lift],
          ]}
          color={COLORS.ink}
          lineWidth={1.2}
        />
      )}
      {pin.driven && (
        <Line
          points={circle(sizes.half * 0.85, pin.zFront + lift)}
          color={COLORS.red}
          lineWidth={2.5}
        />
      )}
      {selected && <Halo at={[0, 0, pin.zFront + 2 * lift]} radius={sizes.half * 1.15} />}
    </group>
  );
}

function Axis({ axis, sizes }: { axis: DrawAxis; sizes: Sizes }) {
  return (
    <Line
      points={[
        [...axis.from, axis.z],
        [...axis.to, axis.z],
      ]}
      color={COLORS.inkSoft}
      lineWidth={1.2}
      dashed
      dashSize={sizes.half * 2.4}
      gapSize={sizes.half * 0.9}
    />
  );
}

/** The drafting symbol for a fixed pivot: a triangle standing on hatched ground. */
function Support({ at, z, sizes }: { at: Point; z: number; sizes: Sizes }) {
  const h = sizes.half;
  const base = -2.3 * h;
  const strokes: Vec3[] = [];
  for (let k = 0; k < 5; k++) {
    const x = -1.8 * h + k * 0.9 * h;
    strokes.push([x, base, 0], [x - 0.6 * h, base - 0.7 * h, 0]);
  }
  return (
    <group position={[at[0], at[1], z]}>
      <Line
        points={[
          [0, 0, 0],
          [-1.4 * h, base, 0],
          [1.4 * h, base, 0],
          [0, 0, 0],
        ]}
        color={COLORS.ink}
        lineWidth={1.4}
      />
      <Line
        points={[
          [-2.2 * h, base, 0],
          [2.2 * h, base, 0],
        ]}
        color={COLORS.ink}
        lineWidth={1.4}
      />
      <Line points={strokes} segments color={COLORS.ink} lineWidth={1} />
    </group>
  );
}

function Ground({ scene, selectedPoint }: { scene: Scene; selectedPoint: string | undefined }) {
  const { sizes, groundZ } = scene;
  return (
    <>
      {scene.supports.map((at) => (
        <Support key={at.join()} at={at} z={groundZ} sizes={sizes} />
      ))}
      {scene.ground.map((p: DrawPoint) => (
        <group key={p.name} position={[p.u, p.v, groundZ]}>
          <Line
            points={[
              [-sizes.half * 0.5, 0, 0],
              [sizes.half * 0.5, 0, 0],
              [0, -sizes.half * 0.5, 0],
              [0, sizes.half * 0.5, 0],
            ]}
            segments
            color={COLORS.ink}
            lineWidth={1}
          />
          {p.name === selectedPoint && <Halo at={[0, 0, 0]} radius={sizes.half * 0.7} />}
        </group>
      ))}
    </>
  );
}

function Grid({ scene }: { scene: Scene }) {
  const { bounds, gridStep } = scene;
  const major = gridStep * 5;
  const x = Math.round((bounds.minX + bounds.maxX) / 2 / major) * major;
  const y = Math.round((bounds.minY + bounds.maxY) / 2 / major) * major;
  const z = scene.groundZ - scene.sizes.pitch;
  const size = major * 40;
  return (
    <group position={[x, y, z]} rotation-x={Math.PI / 2}>
      <gridHelper args={[size, 200, COLORS.grid, COLORS.grid]} />
      <gridHelper args={[size, 40, COLORS.gridMajor, COLORS.gridMajor]} position-y={-1e-5} />
    </group>
  );
}

/** The picture being traced over, lying on the sheet behind the mechanism. */
function UnderlayImage({ scene }: { scene: Scene }) {
  const underlay = useStore((s) => s.underlay);
  const url = underlay?.url;
  const [texture, setTexture] = useState<Texture>();

  useEffect(() => {
    if (!url) {
      setTexture(undefined);
      return;
    }
    let current: Texture | undefined;
    let live = true;
    new TextureLoader().load(url, (loaded) => {
      loaded.colorSpace = SRGBColorSpace;
      current = loaded;
      if (live) setTexture(loaded);
      else loaded.dispose();
    });
    return () => {
      live = false;
      current?.dispose();
    };
  }, [url]);

  if (!underlay || !texture) return null;
  return (
    <mesh position={[underlay.x, underlay.y, scene.groundZ - scene.sizes.pitch * 0.5]}>
      <planeGeometry args={[underlay.width * underlay.scale, underlay.height * underlay.scale]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={underlay.opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function Mechanism({ scene }: { scene: Scene }) {
  const labels = useStore((s) => s.labels);
  const seeThrough = useStore((s) => s.underlay !== undefined);
  const selection = useStore((s) => s.selection);
  const selectedJoint = selection?.kind === "joint" ? selection.id : undefined;
  const selectedBody = selection?.kind === "body" ? selection.id : undefined;
  const [pointBody, pointName] = selection?.kind === "point" ? selection.ref.split(".") : [];
  const groups = useRef(new Map<number, Group>());
  const pose = useRef<[number, number, number]>([0, 0, 0]);

  useFrame((_, delta) => {
    const state = useStore.getState();
    const { cycle } = scene;
    let { step } = state;

    if (state.playing && cycle.count > 1) {
      const dt = cycle.t[1] - cycle.t[0];
      // A long gap means the tab was in the background; do not jump ahead.
      step += (Math.min(delta, 0.1) * state.rate) / dt;
      const end = scene.periodic ? cycle.count : cycle.count - 1;
      if (step >= end) step = scene.periodic ? step % cycle.count : 0;
      state.setStep(step);
    }

    for (const [index, group] of groups.current) {
      poseAt(scene, index, step, pose.current);
      group.position.set(pose.current[0], pose.current[1], 0);
      group.rotation.z = pose.current[2];
    }
  });

  return (
    <>
      <Grid scene={scene} />
      <UnderlayImage scene={scene} />
      <Ground scene={scene} selectedPoint={pointBody === GROUND ? pointName : undefined} />
      {scene.pins
        .filter((pin) => pin.body < 0)
        .map((pin) => (
          <Pin key={pin.id} pin={pin} sizes={scene.sizes} selected={pin.id === selectedJoint} />
        ))}
      {scene.axes
        .filter((axis) => axis.body < 0)
        .map((axis) => (
          <Axis key={axis.id} axis={axis} sizes={scene.sizes} />
        ))}
      {scene.bodies.map((body) => (
        <group
          key={body.id}
          ref={(group) => {
            if (group) groups.current.set(body.index, group);
            else groups.current.delete(body.index);
          }}
        >
          <Plate
            body={body}
            sizes={scene.sizes}
            selected={body.id === selectedBody}
            selectedPoint={pointBody === body.id ? pointName : undefined}
            seeThrough={seeThrough}
          />
          {scene.pins
            .filter((pin) => pin.body === body.index)
            .map((pin) => (
              <Pin key={pin.id} pin={pin} sizes={scene.sizes} selected={pin.id === selectedJoint} />
            ))}
          {scene.wheels
            .filter((wheel) => wheel.body === body.index)
            .map((wheel) => (
              <Wheel key={wheel.id} wheel={wheel} />
            ))}
          {scene.cams
            .filter((cam) => cam.body === body.index)
            .map((cam) => (
              <CamPlate key={cam.id} cam={cam} sizes={scene.sizes} color={body.color} />
            ))}
          {scene.rollers
            .filter((roller) => roller.body === body.index)
            .map((roller) => (
              <Roller key={roller.id} roller={roller} sizes={scene.sizes} />
            ))}
          {scene.axes
            .filter((axis) => axis.body === body.index)
            .map((axis) => (
              <Axis key={axis.id} axis={axis} sizes={scene.sizes} />
            ))}
        </group>
      ))}
      {scene.ties.map((tie) => (
        <Tie key={tie.id} scene={scene} tie={tie} />
      ))}
      {scene.traces.map((trace) => (
        <Line key={trace.ref} points={trace.points} color={COLORS.dye} lineWidth={1.8} />
      ))}
      {labels && <Labels scene={scene} />}
      <Interaction />
    </>
  );
}

/** Distance of the camera from what it looks at; only the direction matters without perspective. */
const CAMERA_DISTANCE = 50;

function Camera({ scene }: { scene: Scene | undefined }) {
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const fitRequest = useStore((s) => s.fitRequest);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as ComponentRef<typeof OrbitControls> | null;
  const size = useThree((s) => s.size);
  const latest = useRef({ scene, size });
  latest.current = { scene, size };
  const hasScene = scene !== undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: fit on request, not on every edit or resize
  useEffect(() => {
    const { scene, size } = latest.current;
    if (!scene || !controls) return;
    const { minX, maxX, minY, maxY } = scene.bounds;
    const margin = scene.sizes.half * 8;
    const width = maxX - minX + margin;
    const height = maxY - minY + margin;
    const target = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, scene.depth / 2);
    const direction = view === "3d" ? new Vector3(0.5, 0.35, 1).normalize() : new Vector3(0, 0, 1);

    camera.zoom = Math.min(size.width / width, size.height / height) * (view === "3d" ? 0.8 : 1);
    camera.position.copy(target).addScaledVector(direction, CAMERA_DISTANCE);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
  }, [fitRequest, view, controls, hasScene]);

  return (
    <OrbitControls
      makeDefault
      enableDamping={false}
      enableRotate={view === "3d"}
      zoomToCursor
      mouseButtons={{
        // With a drawing tool the left button belongs to the tool; pan with the right one.
        LEFT: view === "3d" ? MOUSE.ROTATE : tool === "select" ? MOUSE.PAN : undefined,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      }}
      touches={{ ONE: view === "3d" ? TOUCH.ROTATE : TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}

export function Viewport() {
  const scene = useStore((s) => s.scene);

  return (
    <Canvas
      orthographic
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 0, CAMERA_DISTANCE], near: 0.1, far: 2 * CAMERA_DISTANCE, zoom: 500 }}
      aria-label="Drawing of the mechanism"
    >
      <color attach="background" args={[COLORS.paper]} />
      <ambientLight intensity={2.2} />
      <directionalLight position={[3, 5, 8]} intensity={1.6} />
      {scene && <Mechanism scene={scene} />}
      <Camera scene={scene} />
    </Canvas>
  );
}
