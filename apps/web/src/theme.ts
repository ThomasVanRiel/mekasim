import { create } from "zustand";

export type Theme = "light" | "dark";

/** Colours used inside the 3D scene. */
export interface Palette {
  paper: string;
  grid: string;
  gridMajor: string;
  ink: string;
  inkSoft: string;
  dye: string;
  brass: string;
  red: string;
  /** Steel-like tones for bodies, assigned in order. */
  bodies: string[];
}

/** Keep in step with the tokens in `index.css`. */
export const PALETTES: Record<Theme, Palette> = {
  light: {
    paper: "#edf1ea",
    grid: "#d3ddd0",
    gridMajor: "#b7c6b4",
    ink: "#20282d",
    inkSoft: "#5a666d",
    dye: "#2046c4",
    brass: "#b58a2e",
    red: "#c2362c",
    bodies: ["#6f8ea8", "#9aa573", "#b39274", "#8586b3", "#62a39c", "#b08794"],
  },
  dark: {
    paper: "#151a18",
    grid: "#222a27",
    gridMajor: "#333f3a",
    ink: "#e2e8e1",
    inkSoft: "#9aa8a2",
    dye: "#7d9cff",
    brass: "#c79a3a",
    red: "#ee7468",
    // The same tones, deep enough for the chalk outlines to stand out on them.
    bodies: ["#4a6379", "#69744a", "#7d6149", "#585a82", "#3d726c", "#7b5863"],
  },
};

/** The tone of a body, by its place among the bodies. */
export function bodyColor(palette: Palette, index: number): string {
  return palette.bodies[index % palette.bodies.length] as string;
}

/** Also read by the script in `index.html` that sets the theme before the first paint. */
const STORAGE_KEY = "mekasim.theme";

/** The theme to show: the one chosen here, or else the one the system asks for. */
export function resolveTheme(chosen: string | null, systemDark: boolean): Theme {
  if (chosen === "light" || chosen === "dark") return chosen;
  return systemDark ? "dark" : "light";
}

/**
 * What to remember of a choice. A choice of what the system asks for anyway is not
 * kept, so that the page goes on following the system from then on.
 */
export function remembered(theme: Theme, systemDark: boolean): Theme | undefined {
  return theme === resolveTheme(null, systemDark) ? undefined : theme;
}

const system = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function chosen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  /** Switch between light and dark. The choice is remembered in this browser between visits. */
  toggle(): void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: resolveTheme(chosen(), system?.matches ?? false),
  toggle() {
    const theme = get().theme === "dark" ? "light" : "dark";
    set({ theme });
    apply(theme);
    try {
      const keep = remembered(theme, system?.matches ?? false);
      if (keep) localStorage.setItem(STORAGE_KEY, keep);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  },
}));

apply(useTheme.getState().theme);
system?.addEventListener("change", (event) => {
  const theme = resolveTheme(chosen(), event.matches);
  useTheme.setState({ theme });
  apply(theme);
});

/** The scene colours of the theme being shown. */
export function useColors(): Palette {
  return PALETTES[useTheme((s) => s.theme)];
}
