# CLAUDE.md

mekasim is a browser app for exploring planar mechanisms described in YAML.
The plan and its phases are in `docs/PLAN.md`; the model format is in `docs/FORMAT.md`.
Ideas and known gaps outside the phases are collected in `docs/BACKLOG.md`.

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

## Conventions

- pnpm workspaces: `packages/core` (pure TypeScript, no DOM) and `apps/web` (React).
- Core runs as TypeScript directly in Node, so no `enum` or parameter properties,
  and relative imports carry the `.ts` extension.
- Logic that does not need a browser belongs in plain modules with unit tests
  (Vitest), so it can be verified without one.
