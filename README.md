# mekasim

Explore planar mechanisms: describe linkages, eccentrics and joints in a YAML file,
solve their exact motion and measure what they do.

There is a solver core with a command-line runner, and a browser app that shows a
model moving in 2D and 3D next to its source. Drawing tools are next; see
[docs/PLAN.md](docs/PLAN.md).

## Use

Requires Node 26 and pnpm 11.

```
pnpm install
pnpm dev         # the app, at http://localhost:5173
```

Edit the YAML on the left and the drawing, measures and messages follow. Space
plays and pauses; the arrow keys step through the cycle.

From the command line:

```
pnpm solve examples/shaker.mekasim.yaml
pnpm solve examples/shaker.mekasim.yaml --csv shaker.csv
```

```
Counter-moving shaker decks
  7 moving bodies, 10 joints, 1 driver
  1 degree of freedom, fully determined
  360 of 360 steps solved over 0.214286 s

Measures
  rocker_swing      29.082 deg
  upper_stroke      60.2412 mm
  ...
```

The model format is described in [docs/FORMAT.md](docs/FORMAT.md); start from one
of the files in [`examples/`](examples).

## Develop

```
pnpm build       # production build of the app, into apps/web/dist
pnpm test        # unit tests
pnpm typecheck
pnpm lint        # Biome; `pnpm format` applies fixes
pnpm schema      # regenerate the JSON Schema after changing the format
```

The core package runs as TypeScript directly, without a build step, so its source
is limited to syntax Node can strip (no `enum`, no parameter properties).

```
packages/core/src
  schema/     document format (Zod), YAML loading
  expr/       expression parser, units and dimensions
  compile/    document -> solver model
  solver/     constraints, position/velocity/acceleration, degrees of freedom
  analysis/   motion cycle, measures
  simulate.ts the whole pipeline in one call
  cli.ts      command-line runner
apps/web/src
  store.ts    model text, solved result, playback state
  editor/     YAML source editor
  viewport/   the drawing: scene description, three.js rendering, labels
  panels/     header, measures, messages, timeline, title block
```

The app deploys to Netlify from `netlify.toml` as a static site.
