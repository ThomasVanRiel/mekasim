import { describe, expect, it } from "vitest";
import { useLayout } from "./layout.ts";

describe("panel sizes", () => {
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
