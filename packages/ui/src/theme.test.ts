import { describe, expect, it } from "vitest";
import { PALETTES, remembered, resolveTheme, useTheme } from "./theme.ts";

describe("the theme", () => {
  it("follows the system until one is chosen", () => {
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    // Anything else in storage is not a choice.
    expect(resolveTheme("sepia", true)).toBe("dark");
  });

  it("is remembered only where it differs from the system", () => {
    expect(remembered("dark", false)).toBe("dark");
    expect(remembered("light", true)).toBe("light");
    expect(remembered("dark", true)).toBeUndefined();
    expect(remembered("light", false)).toBeUndefined();
  });

  it("switches between light and dark", () => {
    const start = useTheme.getState().theme;
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).not.toBe(start);
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe(start);
  });

  it("has every scene colour in both themes", () => {
    expect(Object.keys(PALETTES.dark)).toEqual(Object.keys(PALETTES.light));
    expect(PALETTES.dark.bodies).toHaveLength(PALETTES.light.bodies.length);
    for (const { bodies } of Object.values(PALETTES)) {
      expect(new Set(bodies).size).toBe(bodies.length);
    }
  });
});
