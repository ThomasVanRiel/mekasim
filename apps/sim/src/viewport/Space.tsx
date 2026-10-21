import {
  bodyColor,
  type DrawSpaceBody,
  type DrawSpaceJoint,
  type Scene,
  spaceJointAt,
  spacePoseAt,
  useColors,
} from "@mekasim/ui";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Group, Quaternion, Vector3 } from "three";
import { useStore } from "../store.ts";

type Vec3 = [number, number, number];

const UP = new Vector3(0, 1, 0);

/** A rod from one point to another, as a cylinder; three.js stands a cylinder along y. */
function Rod({ from, to, radius, color }: { from: Vec3; to: Vec3; radius: number; color: string }) {
  const { middle, length, turn } = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const along = b.clone().sub(a);
    const length = along.length();
    const turn =
      length > 0 ? new Quaternion().setFromUnitVectors(UP, along.normalize()) : new Quaternion();
    return { middle: a.add(b).multiplyScalar(0.5), length, turn };
  }, [from, to]);
  if (length === 0) return null;
  return (
    <mesh position={middle} quaternion={turn}>
      <cylinderGeometry args={[radius, radius, length, 16]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Body({
  body,
  radius,
  selected,
}: {
  body: DrawSpaceBody;
  radius: number;
  selected: boolean;
}) {
  const colors = useColors();
  const color = selected ? colors.dye : bodyColor(colors, body.index);
  return (
    <>
      {body.rods.map(([from, to]) => (
        <Rod
          key={`${from.join()} ${to.join()}`}
          from={from}
          to={to}
          radius={radius}
          color={color}
        />
      ))}
      {body.points.map(({ name, s }) => (
        <mesh key={name} position={s}>
          <sphereGeometry args={[radius * 1.25, 16, 12]} />
          <meshLambertMaterial color={color} />
        </mesh>
      ))}
    </>
  );
}

function Joint({
  joint,
  radius,
  selected,
}: {
  joint: DrawSpaceJoint;
  radius: number;
  selected: boolean;
}) {
  const colors = useColors();
  const color = selected ? colors.dye : joint.driven ? colors.red : colors.brass;
  return joint.kind === "spherical" ? (
    <mesh>
      <sphereGeometry args={[radius * 2, 20, 14]} />
      <meshLambertMaterial color={color} />
    </mesh>
  ) : (
    <mesh>
      <cylinderGeometry args={[radius * 1.8, radius * 1.8, radius * 6, 24]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

/** What moves in space: its bodies as rods between their points, and its joints. */
export function Space({ scene }: { scene: Scene }) {
  const { space, sizes, periodic } = scene;
  const selection = useStore((s) => s.focus ?? s.selection);
  const bodies = useRef(new Map<string, Group>());
  const joints = useRef(new Map<string, Group>());
  const pose = useRef(new Float64Array(7));
  const at = useRef(new Float64Array(3));
  const axis = useRef(new Float64Array(3));
  const along = useRef(new Vector3());

  useFrame(() => {
    if (!space) return;
    const { step } = useStore.getState();
    for (const body of space.bodies) {
      const group = bodies.current.get(body.id);
      if (!group) continue;
      spacePoseAt(body, step, periodic, pose.current);
      const p = pose.current;
      group.position.set(p[0] as number, p[1] as number, p[2] as number);
      group.quaternion.set(p[3] as number, p[4] as number, p[5] as number, p[6] as number);
    }
    for (const joint of space.joints) {
      const group = joints.current.get(joint.id);
      if (!group) continue;
      spaceJointAt(joint, step, periodic, at.current, joint.axis && axis.current);
      const a = at.current;
      group.position.set(a[0] as number, a[1] as number, a[2] as number);
      if (joint.axis) {
        const h = axis.current;
        along.current.set(h[0] as number, h[1] as number, h[2] as number).normalize();
        group.quaternion.setFromUnitVectors(UP, along.current);
      }
    }
  });

  if (!space) return null;
  const radius = sizes.half * 0.35;
  const selectedBody = selection?.kind === "body" ? selection.id : undefined;
  const selectedJoint = selection?.kind === "joint" ? selection.id : undefined;
  return (
    <>
      {space.bodies.map((body) => (
        <group
          key={body.id}
          ref={(group) => {
            if (group) bodies.current.set(body.id, group);
            else bodies.current.delete(body.id);
          }}
        >
          <Body body={body} radius={radius} selected={body.id === selectedBody} />
        </group>
      ))}
      {space.joints.map((joint) => (
        <group
          key={joint.id}
          ref={(group) => {
            if (group) joints.current.set(joint.id, group);
            else joints.current.delete(joint.id);
          }}
        >
          <Joint joint={joint} radius={radius} selected={joint.id === selectedJoint} />
        </group>
      ))}
    </>
  );
}
