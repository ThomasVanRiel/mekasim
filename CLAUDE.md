# CLAUDE.md

This repository holds two browser apps for planar mechanisms described in YAML, and
the packages they share.

- **mekasim** (`apps/sim`) answers "how does this linkage move?". Its plan is in
  `docs/mekasim/PLAN.md`, its model format in `docs/mekasim/FORMAT.md`, and ideas and
  known gaps in `docs/mekasim/BACKLOG.md`.
- **mekafit** (`apps/fit`, a working name) is for mechanisms that work by parts
  touching: clearance, contact and studies over many starting positions. It is
  planned in `docs/mekafit/PLAN.md`, designed in `docs/mekafit/DESIGN.md`, and its
  format drafted in `docs/mekafit/FORMAT.md`.
- **mekacarve** (a working name, not built yet) shapes a part by running a mekafit
  study, cutting away where the parts get in each other's way. Its plan, with what
  it may not cut and the order of its steps, is in `docs/mekacarve/PLAN.md`.

**To pick up the work, read the status at the top of `docs/mekafit/PLAN.md`:** it
says what is built, what is not, and what comes next. Then work through mekafit in
the order of section 9 of its design.

What has been settled along the way:

- Whatever is useful in mekasim too is built in mekasim, and mekafit builds on it:
  `checks`, conditions in expressions, `shape`, drawings (`geometry:`) and `gap()`
  all went that way. Their code is in `packages/core` and `packages/ui`, not in
  `packages/fit`. Ask Thomas when it is not clear which side something belongs on.
- mekasim must not change for mekafit's sake alone. The example baseline
  (`packages/core/test/baseline.json`) and the schema test guard its numbers and
  its format, and a change to `apps/sim` or `packages/core` made for mekafit is
  checked by Thomas in mekasim's dev server before more is built on it.
- Work is committed straight to `main`, one commit per finished step, once lint,
  typecheck, tests and build pass.

## Checking the UI

Do not use headless browsers or Playwright, and do not add them to the project.
Thomas checks the app himself in a dev server (`pnpm dev`). When a change needs
visual confirmation, say what to look at and wait for his report.

Everything that can be checked without a browser still must be: `pnpm lint`,
`pnpm typecheck`, `pnpm test` and `pnpm build`.

## Commands

- `pnpm dev` — both dev servers: mekasim on port 5173, mekafit on 5174
  (`pnpm dev:sim` and `pnpm dev:fit` for one alone)
- `pnpm build` — production build of both apps (`pnpm build:sim`, `pnpm build:fit`)
- `pnpm test`, `pnpm typecheck`, `pnpm lint` (`pnpm format` applies fixes)
- `pnpm solve <model.mekasim.yaml>` — run the solver from the command line
- `pnpm fit:study <model.mekafit.yaml> <study> [--runs N] [--csv out.csv]` — run one of a
  mekafit model's studies in worker threads and print what it came to
- `pnpm schema` — regenerate the JSON Schema after changing the format
- `pnpm baseline` — rewrite what the examples solve to (`packages/core/test/baseline.json`),
  only after a change that is meant to move their numbers; read the diff

After a dependency or a package is added, removed or renamed, `pnpm` refuses to run
any script until `pnpm install` has been run. Where an install is not possible (as
in Thomas's sandbox, where it would wipe `node_modules`), update the lockfile with
`pnpm install --lockfile-only`, ask Thomas to run `pnpm install`, and until he has,
run the tools directly: `node_modules/.bin/biome check .`, and in each package
`../../node_modules/.bin/tsc --noEmit` and `../../apps/sim/node_modules/.bin/vitest run`
(`vite build` likewise in each app). Say in the report that this is how it was checked.

## Conventions

- pnpm workspaces: `packages/core` and `packages/fit` (pure TypeScript, no DOM),
  `packages/ui` (React parts and the look shared by the apps; no model, no app
  store), `apps/sim` (mekasim) and `apps/fit` (mekafit). The README lists what is
  in each.
- A part of the interface that both apps need goes in `packages/ui` and takes its
  data as properties; each app wires it to its own store.
- Examples are in `examples/`, with the drawings some of them use beside them. A
  new example is added to the baseline with `pnpm baseline`. mekafit's own are in
  `examples/fit/`: each is solved by `packages/fit/test/examples.test.ts`, which
  also holds what is known of its result, and named in `apps/fit/src/examples.test.ts`.
- Messages and interface text are plain sentences without solver terms; see the
  wording notes in `docs/mekafit/PLAN.md` §5.
- Core runs as TypeScript directly in Node, so no `enum` or parameter properties,
  and relative imports carry the `.ts` extension.
- Logic that does not need a browser belongs in plain modules with unit tests
  (Vitest), so it can be verified without one.
