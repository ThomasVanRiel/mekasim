/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The site's Plausible script, `…/js/pa-….js`; none, and nothing is counted. */
  readonly VITE_PLAUSIBLE_SCRIPT?: string;
}
