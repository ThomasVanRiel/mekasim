/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where mekasim is served, for "Open in mekasim". */
  readonly VITE_MEKASIM_URL?: string;
  /** The site's Plausible script, `…/js/pa-….js`; none, and nothing is counted. */
  readonly VITE_PLAUSIBLE_SCRIPT?: string;
}
