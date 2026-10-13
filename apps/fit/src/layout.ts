import { create } from "zustand";

const STORAGE_KEY = "mekafit.layout";
const PANELS = ["source", "side", "run", "messages"] as const;

/** Sizes of the panels in pixels. A size left undefined follows its content or the default. */
export interface Sizes {
  /** Width of the source column. */
  source?: number;
  /** Width of the contacts and later controls beside the sheet. */
  side?: number;
  /** Height of the run panel under the sheet. */
  run?: number;
  /** Height of the messages under the source. */
  messages?: number;
}

function stored(): Sizes {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const sizes: Sizes = {};
    for (const key of PANELS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[key] = value;
    }
    return sizes;
  } catch {
    return {};
  }
}

interface LayoutState extends Sizes {
  /** Set a size, or forget it so that the panel goes back to its default. */
  resize(panel: keyof Sizes, size: number | undefined): void;
}

/** How the panels are laid out. Their sizes are remembered in this browser between visits. */
export const useLayout = create<LayoutState>((set, get) => ({
  ...stored(),
  resize(panel, size) {
    set({ [panel]: size });
    const { source, side, run, messages } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, side, run, messages }));
    } catch {
      // Without storage the sizes last for this visit only.
    }
  },
}));
