import { create } from "zustand";

const STORAGE_KEY = "mekasim.layout";

/** Sizes of the panels in pixels. A size left undefined follows its content or the default. */
export interface Sizes {
  /** Width of the source column. */
  source?: number;
  /** Width of the column with the inspector, parameters and measures. */
  side?: number;
  /** Height of the playback and plots panel. */
  plots?: number;
  /** Height of the messages list under the source. */
  messages?: number;
}

function stored(): Sizes {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const sizes: Sizes = {};
    for (const key of ["source", "side", "plots", "messages"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[key] = value;
    }
    return sizes;
  } catch {
    return {};
  }
}

interface LayoutState extends Sizes {
  /** Whether the help on the format is folded open beside the source. Not remembered. */
  help: boolean;
  setHelp(open: boolean): void;
  /**
   * Whether the skill for an AI assistant is folded open beside the source. It lies
   * where the help does, so opening one puts the other away. Not remembered.
   */
  skill: boolean;
  setSkill(open: boolean): void;
  /** Set a size, or forget it so that the panel goes back to its default. */
  resize(panel: keyof Sizes, size: number | undefined): void;
}

/** How the panels are laid out. Their sizes are remembered in this browser between visits. */
export const useLayout = create<LayoutState>((set, get) => ({
  ...stored(),
  help: false,
  setHelp: (help) => set(help ? { help, skill: false } : { help }),
  skill: false,
  setSkill: (skill) => set(skill ? { skill, help: false } : { skill }),
  resize(panel, size) {
    set({ [panel]: size });
    const { source, side, plots, messages } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, side, plots, messages }));
    } catch {
      // Without storage the sizes last for this visit only.
    }
  },
}));

/** Keep a size within what a panel can usefully be. */
export function clamp(size: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)));
}
