# mekasim

Explore planar mechanisms: describe linkages, eccentrics and joints in a YAML file,
solve their exact motion and measure what they do.

The solver core and a command-line runner exist today. The browser app (2D and 3D
view, drawing tools) is next; see [docs/PLAN.md](docs/PLAN.md).

## Use

Requires Node 26 and pnpm 11.

```
pnpm install
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
```
