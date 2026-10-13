import { describe, expect, it } from "vitest";
import { useLayout } from "./layout.ts";

describe("panel sizes", () => {
  it("can be set and forgotten, each on its own", () => {
    useLayout.getState().resize("run", 280);
    useLayout.getState().resize("source", 400);
    expect(useLayout.getState()).toMatchObject({ run: 280, source: 400 });
    useLayout.getState().resize("run", undefined);
    expect(useLayout.getState().run).toBeUndefined();
    expect(useLayout.getState().source).toBe(400);
    useLayout.getState().resize("source", undefined);
  });
});
