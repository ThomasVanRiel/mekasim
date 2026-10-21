import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/simulate.ts";
import { placePoint, unturn, type Vec3 } from "../src/solver/spatial.ts";

const TEXT = readFileSync(
  new URL("../../../examples/spatial/swash-plate.mekasim.yaml", import.meta.url),
  "utf8",
);

/** The example with its cyclic and collective set. */
function withControls(cyclic: string, collective: string): string {
  return TEXT.replace(/cyclic: 5 deg/, `cyclic: ${cyclic}`).replace(
    /collective: 0 mm/,
    `collective: ${collective}`,
  );
}

/**
 * The pitch of each blade over a turn of the rotor: how far its leading edge is turned
 * up about its span, seen from the hub. Each blade's pitch horn points along its
 * leading edge, so the pitch is the horn's angle above the hub's plane.
 */
function pitches(text: string): [number[], number[]] {
  const { compiled, cycle, diagnostics } = simulate(text);
  expect(diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  if (!compiled || !cycle) throw new Error("does not solve");
  expect(cycle.count).toBe(360);
  const rotor = compiled.spatial.get("rotor");
  if (!rotor) throw new Error("no rotor");
  const out: [number[], number[]] = [[], []];
  for (let k = 0; k < cycle.count; k++) {
    const q = cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width);
    ["blade_1", "blade_2"].forEach((id, i) => {
      const blade = compiled.spatial.get(id);
      if (!blade) throw new Error(`no ${id}`);
      const at = (name: string): Vec3 =>
        placePoint(q, { at: blade.at, s: blade.points.get(name) as Vec3 });
      const [g, h] = [at("G"), at("H")];
      // The horn seen from the hub; blade 2's leading edge is towards the hub's -y.
      const [, y, z] = unturn(q, { at: rotor.at }, [h[0] - g[0], h[1] - g[1], h[2] - g[2]]);
      out[i]?.push(Math.atan2(z, i === 0 ? y : -y));
    });
  }
  return out;
}

const degrees = (rad: number): number => (rad * 180) / Math.PI;

describe("the swash plate example", () => {
  it("has one degree of freedom, with the three links' spins named", () => {
    const { mobility, diagnostics } = simulate(TEXT);
    expect(mobility).toMatchObject({ mobility: 1, free: 0, idle: 3, redundant: 0 });
    expect(mobility?.idleBodies.sort()).toEqual(["drive_link", "pitch_1", "pitch_2"]);
    expect(diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("gives the blades a cyclic pitch, once a turn, as far as the plate's tilt says", () => {
    const [first, second] = pitches(TEXT);
    // A pitch link at (35, 30) mm from the plate's centre rises and falls by
    // sin(5°) times its distance, 46 mm, over a 30 mm horn.
    const expected = degrees(Math.asin((Math.sin((5 * Math.PI) / 180) * Math.hypot(35, 30)) / 30));
    for (const pitch of [first, second]) {
      const high = degrees(Math.max(...pitch));
      const low = degrees(Math.min(...pitch));
      expect(high).toBeCloseTo(expected, 0);
      expect(low).toBeCloseTo(-expected, 0);
      // Once a turn: it crosses zero going up exactly once.
      const ups = pitch.filter((p, k) => p <= 0 && (pitch[(k + 1) % pitch.length] as number) > 0);
      expect(ups).toHaveLength(1);
    }
    // The second blade is half a turn behind the first.
    for (let k = 0; k < 360; k += 30) {
      expect(second[k]).toBeCloseTo(first[(k + 180) % 360] as number, 2);
    }
  });

  it("gives both blades one steady pitch with collective alone", () => {
    const [first, second] = pitches(withControls("0 deg", "5 mm"));
    // The horn's end turns about the blade's span, and the 80 mm pitch link from the
    // plate, raised 5 mm, keeps its length: (30 cos b - 30)² + (75 + 30 sin b)² = 80².
    const gap = (b: number): number =>
      Math.hypot(30 * Math.cos(b) - 30, 75 + 30 * Math.sin(b)) - 80;
    let [lo, hi] = [0, 0.5];
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) < 0) lo = mid;
      else hi = mid;
    }
    const expected = lo;
    // Steady over the turn, and the same on both blades.
    const steady = first[0] as number;
    for (const p of [...first, ...second]) expect(Math.abs(p - steady)).toBeLessThan(1e-9);
    // Raised, the drive link tips and the rotating plate lags the hub by about 0.6°,
    // which leans the pitch links a little: the pitch is that much off the simple sum.
    expect(Math.abs(steady - expected)).toBeLessThan(2e-4);
  });

  it("holds the blades flat with the controls at rest", () => {
    const [first, second] = pitches(withControls("0 deg", "0 mm"));
    for (const p of [...first, ...second]) expect(Math.abs(p)).toBeLessThan(1e-9);
  });
});
