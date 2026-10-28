/**
 * Counting visits and what is done in the apps, with a self-hosted Plausible.
 *
 * Nothing is sent unless the build names the site's script (`VITE_PLAUSIBLE_SCRIPT`),
 * and Plausible itself sends nothing from localhost. The model never leaves the
 * browser: it travels in the part of the link after `#`, which Plausible does not
 * send, and the events carry no more than which button was used. The events and the
 * goals made of them are listed in `docs/ANALYTICS.md`.
 */

/** The events the apps send, by the name their goals have in Plausible. */
export type AnalyticsEvent =
  | "New model"
  | "Load example"
  | "Open file"
  | "Open link"
  | "Download model"
  | "Copy link"
  | "Open in mekasim"
  | "Make"
  | "Export CSV"
  | "AI skill"
  | "Run study";

type Props = Record<string, string | number | boolean>;

interface Plausible {
  (event: string, options?: { props?: Props }): void;
  q?: unknown[];
  init?: (options?: object) => void;
  o?: object;
}

declare global {
  interface Window {
    plausible?: Plausible;
  }
}

/**
 * The site's script from the build's setting, or undefined when none is given. Each
 * site in Plausible has its own script (`/js/pa-….js`), which names the site itself.
 */
export function analyticsScript(src: string | undefined): string | undefined {
  return src?.trim() || undefined;
}

/** Load the site's script, as Plausible's snippet does; events sent before it loads wait for it. */
export function startAnalytics(src: string | undefined): void {
  if (!src || window.plausible) return;
  const queued: Plausible = (...args) => {
    queued.q ??= [];
    queued.q.push(args);
  };
  queued.init = (options) => {
    queued.o = options ?? {};
  };
  window.plausible = queued;
  queued.init();
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.append(script);
}

/** Count an event; nothing happens where analytics are off. */
export function track(event: AnalyticsEvent, props?: Props): void {
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // Counting must never get in the way of the app.
  }
}
