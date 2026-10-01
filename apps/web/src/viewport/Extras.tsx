import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Shape, Vector2 } from "three";
import type { Line2, LineSegments2 } from "three-stdlib";
import { useStore } from "../store.ts";
import { COLORS } from "../theme.ts";
import { toWorld } from "./pick.ts";
import type { DrawCam, DrawRoller, DrawTie, DrawWheel, Scene, Sizes } from "./scene.ts";

type Vec3 = [number, number, number];

function circle(radius: number, z: number, segments = 64): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, k): Vec3 => {
    const angle = (2 * Math.PI * k) / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  });
}

/** A gear or pulley on its body: the pitch circle, and marks round it that show it turning. */
export function Wheel({ wheel }: { wheel: DrawWheel }) {
  const marks = useMemo(() => {
    const count = Math.max(8, Math.min(48, Math.round(wheel.radius * 400)));
    const points: Vec3[] = [];
    for (let k = 0; k < count; k++) {
      const angle = (2 * Math.PI * k) / count;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      points.push([wheel.radius * 0.9 * c, wheel.radius * 0.9 * s, wheel.z]);
      points.push([wheel.radius * c, wheel.radius * s, wheel.z]);
    }
    return points;
  }, [wheel.radius, wheel.z]);

  return (
    <group position={[wheel.u, wheel.v, 0]}>
      <Line points={circle(wheel.radius, wheel.z)} color={COLORS.ink} lineWidth={1.4} />
      <Line points={marks} segments color={COLORS.ink} lineWidth={1} />
      {/* One longer mark makes a full turn easy to count. */}
      <Line
        points={[
          [0, 0, wheel.z],
          [wheel.radius, 0, wheel.z],
        ]}
        color={COLORS.ink}
        lineWidth={1}
      />
    </group>
  );
}

/** A cam plate on its body. */
export function CamPlate({ cam, sizes, color }: { cam: DrawCam; sizes: Sizes; color: string }) {
  const shape = useMemo(
    () => new Shape(cam.outline.map(([x, y]) => new Vector2(x, y))),
    [cam.outline],
  );
  const front = cam.z + sizes.thickness;
  const lift = sizes.thickness * 0.04;
  const edge = [...cam.outline, cam.outline[0] as [number, number]].map(
    ([x, y]): Vec3 => [x, y, front + lift],
  );
  return (
    <>
      <mesh position-z={cam.z}>
        <extrudeGeometry args={[shape, { depth: sizes.thickness, bevelEnabled: false }]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <Line points={edge} color={COLORS.ink} lineWidth={1.4} />
    </>
  );
}

/** The roller of a cam follower, on the follower's body. */
export function Roller({ roller, sizes }: { roller: DrawRoller; sizes: Sizes }) {
  // A follower without a roller is a point; show it as a small one.
  const radius = roller.radius > 0 ? roller.radius : sizes.half * 0.3;
  return (
    <group position={[roller.u, roller.v, 0]}>
      <mesh position-z={roller.z}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={COLORS.paper} />
      </mesh>
      <Line points={circle(radius, roller.z)} color={COLORS.ink} lineWidth={1.4} />
    </group>
  );
}

/**
 * A line between two moving bodies, redrawn every frame: a dashed line for a fixed
 * distance, the two straight runs of a belt for a belt.
 */
export function Tie({ scene, tie }: { scene: Scene; tie: DrawTie }) {
  const line = useRef<Line2 | LineSegments2>(null);

  useFrame(() => {
    const target = line.current;
    if (!target) return;
    const { step } = useStore.getState();
    const [ax, ay] = toWorld(scene, tie.a.body, step, tie.a.u, tie.a.v);
    const [bx, by] = toWorld(scene, tie.b.body, step, tie.b.u, tie.b.v);
    const { z } = tie;
    if (tie.kind === "distance") {
      target.geometry.setPositions([ax, ay, z, bx, by, z]);
      target.computeLineDistances();
      return;
    }
    // The belt leaves each wheel where a line touching both wheels meets it.
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const ex = (bx - ax) / d;
    const ey = (by - ay) / d;
    const along = (tie.a.radius - tie.b.radius) / d;
    const across = Math.sqrt(Math.max(0, 1 - along * along));
    const positions: number[] = [];
    for (const side of [1, -1]) {
      const mx = along * ex - side * across * ey;
      const my = along * ey + side * across * ex;
      positions.push(ax + tie.a.radius * mx, ay + tie.a.radius * my, z);
      positions.push(bx + tie.b.radius * mx, by + tie.b.radius * my, z);
    }
    target.geometry.setPositions(positions);
  });

  // The points given here only size the line; the frame loop sets the real ones.
  return tie.kind === "distance" ? (
    <Line
      ref={line}
      points={[
        [0, 0, 0],
        [1, 0, 0],
      ]}
      color={COLORS.inkSoft}
      lineWidth={1.6}
      dashed
      dashSize={scene.sizes.half * 1.2}
      gapSize={scene.sizes.half * 0.8}
    />
  ) : (
    <Line
      ref={line}
      points={[
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ]}
      segments
      color={COLORS.ink}
      lineWidth={1.6}
    />
  );
}
