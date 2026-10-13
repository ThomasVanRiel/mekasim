# CLAUDE.md

mekasim is a browser app for exploring planar mechanisms described in YAML.
The plan and its phases are in `docs/PLAN.md`; the model format is in `docs/FORMAT.md`.
Ideas and known gaps outside the phases are collected in `docs/BACKLOG.md`.

A second app, mekafit (working name), for part shapes, clearance, contact and
studies, is planned in `docs/mekafit/PLAN.md`, designed in `docs/mekafit/DESIGN.md`
and its format drafted in `docs/mekafit/FORMAT.md`. It lives in `apps/fit` with
`packages/fit` and shares `packages/ui` and `packages/core` with mekasim. Work through
it in the order of section 9 of the design. mekasim's behaviour, format and look must
not change: the example baseline and schema tests guard that, and any change to
`apps/web` or `packages/core` for mekafit's sake is checked by Thomas in mekasim's
dev server before more is built on it.

## Checking the UI

Do not use headless browsers or Playwright, and do not add them to the project.
Thomas checks the app himself in a dev server (`pnpm dev`). When a change needs
visual confirmation, say what to look at and wait for his report.

Everything that can be checked without a browser still must be: `pnpm lint`,
`pnpm typecheck`, `pnpm test` and `pnpm build`.

## Commands

- `pnpm dev` — web app dev server
- `pnpm build` — production build of the web app
- `pnpm test`, `pnpm typecheck`, `pnpm lint` (`pnpm format` applies fixes)
- `pnpm solve <model.mekasim.yaml>` — run the solver from the command line
- `pnpm schema` — regenerate the JSON Schema after changing the format
- `pnpm baseline` — rewrite what the examples solve to (`packages/core/test/baseline.json`),
  only after a change that is meant to move their numbers; read the diff

## Conventions

- pnpm workspaces: `packages/core` (pure TypeScript, no DOM), `packages/ui` (React
  parts and the look shared by the apps; no model, no app store) and `apps/web` (React).
- Core runs as TypeScript directly in Node, so no `enum` or parameter properties,
  and relative imports carry the `.ts` extension.
- Logic that does not need a browser belongs in plain modules with unit tests
  (Vitest), so it can be verified without one.
