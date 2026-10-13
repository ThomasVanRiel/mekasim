import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  type Cycle,
  cycleFromPositions,
  Document,
  documentSchema,
  ExprError,
  jacobian,
  jsonSchema,
  load,
  matFrom,
  nullSpace,
  type Registry,
  simulate,
  solveCycle,
  svd,
} from "../src/index.ts";

const fourBar = readFileSync(
  new URL("../../../examples/four-bar.mekasim.yaml", import.meta.url),
  "utf8",
);

/** The model with a line added at the end of a section it already has. */
function withMeasure(line: string): string {
  return fourBar.replace("measures:\n", `measures:\n  ${line}\n`);
}

const messages = (text: string, options?: Parameters<typeof simulate>[1]): string[] =>
  simulate(text, options).diagnostics.map((d) => d.message);

describe("a schema built on mekasim's", () => {
  const extended = documentSchema({
    version: { key: "mekafit", value: 1 },
    body: { shape: z.string().optional() },
    joint: { stops: z.tuple([z.number(), z.number()]).optional() },
    sections: { contacts: z.array(z.string()).optional() },
  });
  const fit = fourBar
    .replace("mekasim: 1", "mekafit: 1")
    .replace("bodies:\n", "contacts: [crank, rocker]\nbodies:\n");

  it("is mekasim's own when nothing is added", () => {
    expect(documentSchema()).toBe(Document);
  });

  it("leaves mekasim's schema as it was", () => {
    const before = JSON.stringify(jsonSchema());
    documentSchema({ body: { shape: z.string() }, sections: { contacts: z.string() } });
    expect(JSON.stringify(jsonSchema())).toBe(before);
    // What the other format adds is still an error in a mekasim model.
    expect(load(fit.replace("mekafit: 1", "mekasim: 1")).diagnostics.map((d) => d.path)).toEqual([
      [],
    ]);
  });

  it("reads its own first line, and a mekasim model as it is", () => {
    expect(load(fit, extended).diagnostics).toEqual([]);
    expect(load(fourBar, extended).diagnostics).toEqual([]);
    expect(load(fourBar, extended).doc).toEqual(load(fourBar).doc);
  });

  it("wants one first line, not both and not neither", () => {
    const message = 'A model starts with "mekafit: 1" or "mekasim: 1"';
    expect(load(fit.replace("mekafit: 1\n", ""), extended).diagnostics[0]?.message).toBe(message);
    expect(
      load(fit.replace("mekafit: 1", "mekafit: 1\nmekasim: 1"), extended).diagnostics[0]?.message,
    ).toBe(message);
  });

  it("takes the added fields on bodies and joints, and still no others", () => {
    const shaped = fit.replace(/^( {2}crank:\n)/m, "$1    shape: M 0 0\n");
    expect(shaped).not.toBe(fit);
    expect(load(shaped, extended).diagnostics).toEqual([]);
    expect(load(shaped.replace("shape:", "shap:"), extended).diagnostics).toHaveLength(1);
    expect(load(shaped).diagnostics.length).toBeGreaterThan(0);
  });
});

describe("units and functions added to the expressions", () => {
  const registry: Registry = {
    units: { N: { dim: [1, -2, 1, 0], factor: 1 }, kN: { dim: [1, -2, 1, 0], factor: 1000 } },
    functions: {
      final({ args, node, evaluate }) {
        if (args.length !== 1) throw new ExprError("final() takes 1 argument", node.pos);
        const { value, dim } = evaluate(args[0] as (typeof args)[number]);
        return { value: typeof value === "number" ? value : (value.at(-1) as number), dim };
      },
      bodies: ({ compiled, cycle }) => ({
        value: compiled.model.bodies.length * cycle.count,
        dim: [0, 0, 0, 0],
      }),
    },
  };

  it("are not there unless they are given", () => {
    expect(messages(withMeasure("load: 2 kN"))).toEqual(['Unknown unit "kN" in "2 kN"']);
    expect(messages(withMeasure("end: final(angle(rocker))"))).toEqual([
      'Unknown function "final"',
    ]);
  });

  it("are read in measures when they are", () => {
    const simulation = simulate(
      withMeasure("load: 2 kN + 5 N\n  end: final(angle(rocker))\n  size: bodies()"),
      { registry },
    );
    expect(simulation.diagnostics).toEqual([]);
    const value = (id: string) => simulation.measures.find((m) => m.id === id)?.quantity;
    expect(value("load")).toEqual({ value: 2005, dim: [1, -2, 1, 0] });
    const rocker = simulate(withMeasure("turned: angle(rocker)")).measures.find(
      (m) => m.id === "turned",
    )?.quantity?.value as Float64Array;
    expect(value("end")?.value).toBe(rocker.at(-1));
    expect(value("size")?.value).toBe(3 * 360);
  });

  it("report their own errors as any function does", () => {
    expect(messages(withMeasure("end: final(1, 2)"), { registry })).toEqual([
      "final() takes 1 argument",
    ]);
  });
});

describe("hooks into the pipeline", () => {
  const plain = simulate(fourBar);

  it("leave the result alone when none are given", () => {
    const again = simulate(fourBar, {});
    expect(again.diagnostics).toEqual(plain.diagnostics);
    expect(again.cycle?.q).toEqual(plain.cycle?.q);
    expect(again.measures).toEqual(plain.measures);
  });

  it("let the compiled model be added to, and stop on a problem reported there", () => {
    let seen = 0;
    const extended = simulate(fourBar, {
      extend(compiled, doc) {
        seen = compiled.model.constraints.length + Object.keys(doc.bodies).length;
      },
    });
    expect(seen).toBeGreaterThan(0);
    expect(extended.cycle?.q).toEqual(plain.cycle?.q);

    const stopped = simulate(fourBar, {
      extend: (_compiled, _doc, report) =>
        report({ severity: "error", message: "No such shape", path: ["bodies", "crank"] }),
    });
    expect(stopped.cycle).toBeUndefined();
    expect(stopped.diagnostics).toMatchObject([{ message: "No such shape" }]);
    expect(stopped.diagnostics[0]?.position).toBeDefined();
  });

  it("let the motion be solved some other way", () => {
    let solved: Cycle | undefined;
    const replaced = simulate(fourBar, {
      solve(compiled) {
        const cycle = solveCycle(compiled.model, compiled.period, compiled.steps);
        const rows = Array.from(cycle.t, (_, k) =>
          cycle.q.subarray(k * cycle.width, (k + 1) * cycle.width),
        );
        solved = cycleFromPositions(cycle.t, rows);
        return solved;
      },
    });
    expect(replaced.cycle).toBe(solved);
    expect(replaced.diagnostics).toEqual(plain.diagnostics);
    // Positions are the same, so what is measured from them is; speeds are only close.
    const value = (s: typeof plain, id: string) =>
      s.measures.find((m) => m.id === id)?.quantity?.value as number;
    expect(value(plain, "rocker_swing")).toBeGreaterThan(0);
    expect(value(replaced, "rocker_swing")).toBe(value(plain, "rocker_swing"));
    expect(value(replaced, "peak_speed") / value(plain, "peak_speed")).toBeCloseTo(1, 3);
  });
});

describe("what a solver built on this one works with", () => {
  it("gives a cycle from positions, with speeds from their differences", () => {
    // Uneven times, as a run that splits its steps gives.
    const t = [0, 0.1, 0.15, 0.3, 0.4, 0.45, 0.6];
    const cycle = cycleFromPositions(
      t,
      t.map((time) => [time * time, 3 * time]),
      10,
    );
    expect(cycle).toMatchObject({ steps: 10, count: 7, width: 2 });
    t.forEach((time, k) => {
      // A parabola and a line are met exactly, at the ends as well.
      expect(cycle.qd[2 * k]).toBeCloseTo(2 * time, 10);
      expect(cycle.qd[2 * k + 1]).toBeCloseTo(3, 10);
      expect(cycle.qdd[2 * k + 1]).toBeCloseTo(0, 8);
    });
    expect(cycle.qdd[2 * 3]).toBeCloseTo(2, 8);
    expect(cycleFromPositions([0], [[1, 2]]).qd).toEqual(new Float64Array(2));
    expect(cycleFromPositions([0, 2], [[1], [5]]).qd).toEqual(Float64Array.of(2, 2));
  });

  it("gives the directions a set of equations leaves free", () => {
    const a = matFrom([
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const free = nullSpace(svd(a));
    expect([free.rows, free.cols]).toEqual([3, 2]);
    for (let column = 0; column < 2; column++) {
      expect(free.data[column]).toBeCloseTo(0, 12);
      expect(
        Math.hypot(free.data[2 + column] as number, free.data[4 + column] as number),
      ).toBeCloseTo(1, 12);
    }
    expect(
      nullSpace(
        svd(
          matFrom([
            [1, 0],
            [0, 1],
          ]),
        ),
      ).cols,
    ).toBe(0);
  });

  it("leaves a driven four-bar no direction to move in", () => {
    const { compiled, cycle } = simulate(fourBar);
    if (!compiled || !cycle) throw new Error("the example does not solve");
    const jac = jacobian(compiled.model, cycle.q.subarray(0, cycle.width));
    expect(nullSpace(svd(jac)).cols).toBe(0);
  });
});
