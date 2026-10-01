import { describe, expect, it } from "vitest";
import { clamp, useLayout } from "./layout.ts";

describe("panel sizes", () => {
  it("are kept within what a panel can usefully be", () => {
    expect(clamp(50, 220, 800)).toBe(220);
    expect(clamp(900, 220, 800)).toBe(800);
    expect(clamp(333.6, 220, 800)).toBe(334);
    // A window too small for the usual limits still gives the smallest size.
    expect(clamp(300, 220, 100)).toBe(220);
  });

  it("can be set and forgotten", () => {
    useLayout.getState().resize("plots", 280);
    expect(useLayout.getState().plots).toBe(280);
    useLayout.getState().resize("plots", undefined);
    expect(useLayout.getState().plots).toBeUndefined();
  });

  it("leave the help folded away until it is asked for", () => {
    expect(useLayout.getState().help).toBe(false);
    useLayout.getState().setHelp(true);
    expect(useLayout.getState().help).toBe(true);
    useLayout.getState().setHelp(false);
  });

  it("show the help or the skill, never both", () => {
    useLayout.getState().setHelp(true);
    useLayout.getState().setSkill(true);
    expect(useLayout.getState()).toMatchObject({ help: false, skill: true });
    useLayout.getState().setHelp(true);
    expect(useLayout.getState()).toMatchObject({ help: true, skill: false });
    useLayout.getState().setHelp(false);
    expect(useLayout.getState()).toMatchObject({ help: false, skill: false });
  });
});
