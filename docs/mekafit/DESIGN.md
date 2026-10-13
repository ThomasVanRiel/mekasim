# mekafit — design

Technical design for the phases of [PLAN.md](PLAN.md), written for whoever builds
them, person or coding agent. The format is in [FORMAT.md](FORMAT.md). The
conventions of the repository's [CLAUDE.md](../../CLAUDE.md) apply throughout:
TypeScript run directly by Node in the packages (no `enum`, no parameter
properties, `.ts` in relative imports), no DOM in `packages/core` or
`packages/fit`, Vitest for everything that can be tested without a browser, no
Playwright.

## 1. Where the code goes

```
packages/core/src            mekasim's core; only the extension points of §2.3 are added
packages/fit/src
  schema.ts       mekafit document: mekasim's schema extended (§2.3)
                  (shapes are mekasim's too, so their code is in packages/core:
                  src/geometry for outlines and path text, src/drawing for reading
                  DXF, joining outlines and resolving `geometry:`; the Geometry tab
                  is in packages/ui/src/drawings)
  load.ts         reads `mekafit: 1` and `mekasim: 1` files, with the geometry files they name
  files.ts        resolves `geometry:` and `shape.from` into outlines; flattens them for share links
  copy.ts         the `copy` component, expanded on the document before compile
  compile.ts      shapes, contacts, springs, locks, stops, move drivers on top of core's compile
  simulate.ts     the whole pipeline in one call, choosing the solve path (§5.10)
  geometry/
    path.ts       parse and write path text (M L H V A Z), validate outlines
    shape.ts      Segment (line | arc), Loop, Shape; transforms, bounds, area
    distance.ts   exact nearest points between segments and between shapes
    contacts.ts   several nearest points per pair of shapes, for the contact step
    tree.ts       bounding-box tree over a shape's segments
  import/
    dxf.ts        DXF entities -> loops (LINE ARC CIRCLE LWPOLYLINE POLYLINE SPLINE ELLIPSE INSERT)
    svg.ts        SVG elements -> loops
    loops.ts      join ends, chain into closed loops, nest, fit arcs to curves
  solver/
    inequality.ts one-sided constraints: gap, stop, lock
    qp.ts         small dense quadratic program (dual active set)
    quasistatic.ts the contact step and the stage-driven run
    springs.ts    spring energy, gradient and Gauss-Newton Hessian
  measures.ts     gap, force, torque, latched, final, first (registered through §2.3)
  export/dxf.ts   shapes to DXF, reusing core's DXF writer
  study/
    random.ts     seeded generator (splitmix32 seeding xoshiro128**)
    sample.ts     random, spread (Latin hypercube), grid
    run.ts        one run: draw -> edited text -> simulate -> pass/fail
    stats.ts      pass rate with Wilson interval, per-parameter rates, telling parameters
  cli.ts          `pnpm fit:solve` and `pnpm fit:study`, studies in worker_threads
packages/ui/src
  theme.ts, theme.css, fonts     from apps/sim (§2.1)
  Fold.tsx, Splitter.tsx, Choice.tsx
  plot/           Chart.tsx, charts.ts, geometry.ts from apps/sim
  io/             share.ts, download.ts from apps/sim
  sheet/          SVG sheet: pan, zoom, grid, labels, dimensions (new; used by mekafit)
apps/fit/src
  store.ts        model text, solved run, playback, study results, shown run
  App.tsx         layout (§7)
  sheet/          the drawing: shapes, pins, gaps, contact points, locks
  panels/         Header, Geometry (tab), Inspector, Contacts, SpringsLocks, Studies, Parameters,
                  Run, StudyResults
  io/project.ts   open and save: folder (File System Access API) or `.zip` (fflate), follow file
  study/          worker, runner, scatter
```

Package names: `@mekasim/core` (as now), `@mekasim/fit`, `@mekasim/ui`, and the app
`@mekasim/fit-web`. Root scripts added: `dev:fit`, `build:fit`, `fit:solve`,
`fit:study`. `pnpm test`, `typecheck` and `lint` cover every package as they do now.

## 2. Phase 0: the split

### 2.1 packages/ui

Moved from `apps/sim/src` unchanged except for import paths, because none of them
reads mekasim's store:

`theme.ts`, the colour tokens and font imports of `index.css` (as `theme.css`),
`names.ts` (which `plot/charts.ts` uses), `panels/Fold.tsx`, `panels/Choice.tsx`,
`plot/Chart.tsx`, `plot/charts.ts`, `plot/geometry.ts`, `io/share.ts`,
`io/download.ts`, and their tests.

`panels/Splitter.tsx` moves with one change, because it reads mekasim's layout
store (`layout.ts`, with mekasim's panel names and its `mekasim.layout` key in the
browser's storage). In `packages/ui` it takes what it read as props: `size` (a
number, or undefined for the default) and `onResize(size | undefined)`, and no
longer names a panel. `clamp` moves with it. `layout.ts` stays in `apps/sim`, and
so does a `panels/Splitter.tsx` of a few lines that takes `panel` as before, reads
and writes `useLayout`, and renders the shared one; mekasim's use of it does not
change. mekafit has a layout store of its own, with its own panels and key.

Also moved, beyond what was first listed: `viewport/scene.ts`, the description of
the drawing (outlines, pins, slots, wheels, cams, traces, the pose at a step), which
needs only the core, so that mekafit's sheet draws a mekasim model from the same
description as mekasim's Three.js view; and the rules for the page itself (body,
focus ring, the scrubber) into `theme.css`, so that `apps/sim`'s `index.css` only
imports.

`packages/ui` depends on `@mekasim/core` (the charts are built from its results) and
on `zustand` (`theme.ts` keeps the chosen theme in a small store of its own). It
holds no model and no session state.

`apps/sim` imports them from `@mekasim/ui`. Its `index.css` keeps what is mekasim's
own and imports `@mekasim/ui/theme.css`. Tailwind v4 only finds classes in files it
scans, so both apps' CSS adds `@source` for `packages/ui/src`.

Moved later, when mekafit needs them, after being changed to take their data as
props instead of reading the store: `panels/Field.tsx`, `panels/Messages.tsx`,
`panels/Timeline.tsx`, `editor/SourceEditor.tsx` with `editor/history.ts` and
`editor/linked.ts`. Each move is its own change, checked in mekasim before going on.

New in `packages/ui/src/sheet/`: an SVG sheet with pan (middle button or Space and
drag; a Space that moved the sheet does not also start or stop playback), zoom to
the cursor (wheel), fit (F), a grid that follows the zoom, labels
that keep their size, and dimension lines with values. The geometry (view
transform, grid spacing, label placement) is in plain modules with tests. The
embeddable viewer in mekasim's backlog can use the same sheet later.

### 2.2 Guarding mekasim

Two tests are added before anything moves:

- Every file in `examples/` is solved and its measures and the first, middle and
  last pose are compared with values stored in `packages/core/test/baseline.json`
  (written once by a script, then committed).
- `packages/core/schema/mekasim-1.schema.json` regenerated by `pnpm schema` must be
  unchanged (the test regenerates it in memory and compares).

Thomas checks mekasim in `pnpm dev` after the move, before phase 0 continues.

### 2.3 Extension points in core

Four, each with a test showing that without it mekasim gives exactly what it gave
before. Whatever an extension adds is off unless asked for: mekasim asks for
nothing, so nothing new becomes valid in a mekasim model.

1. **Schema.** `schema/document.ts` builds the document schema with a function,
   `documentSchema(extra?)`, where `extra` can add fields to bodies and to joints,
   add sections, and give the other format's first line. mekasim's `Document` is
   `documentSchema()`. mekafit's `schema.ts` calls it with shapes, stops, contacts,
   springs, latches, studies and `mekafit: 1`. The `move` driver is a new kind of
   driver, not a field on mekasim's; `extra` gets a way to add it when phase 3
   builds it.
2. **Expressions.** `expr/` and `analysis/measures.ts` accept a registry of extra
   units and extra functions. A function gets its arguments and a context with the
   compiled model and the sample index, and returns a value or a signal. mekasim
   passes no registry.

   Comparisons, `and`, `or` and `not` need no extension: mekasim has them, with
   its `checks:` section (`docs/mekasim/FORMAT.md`). A study's `pass` is made of the same
   conditions, and the model's checks are what it tests by default (§6.1).
3. **Compile and solve.** `simulate(text, options?)` takes the schema and the
   registry, and optional hooks: `prepare`, which rewrites the document once it is
   read and before it is compiled (shapes from drawings are put in as path text
   there, and `copy` will be expanded there); `extend`, which adds to the compiled model and can
   report problems, and `solve`, which replaces the cycle solve and returns a
   `Cycle`. Without them it is today's `simulate`. Compile already maps names to
   body indices; those maps are exported in its result.
4. **Exports.** `index.ts` exports the pieces mekafit's solver builds on: the
   `Constraint` interface and its constructors, `residual`, `jacobian`,
   `solvePosition`, the SVD and null space of `linalg.ts`, `place` of points, and
   `cycleFromPositions`, which builds a `Cycle` from sampled positions with
   velocities and accelerations as their differences (§5.9).

`copy` needs no hook: it is expanded on the parsed document before compile.

### 2.4 apps/fit skeleton

Vite and React as in `apps/sim`, with the same Biome, TypeScript and Tailwind
settings. Opens a model (file, share link or the last one kept in the browser),
solves it with `@mekasim/fit`, draws bodies on the SVG sheet (the plate outlines
mekasim draws, until shapes exist), plays and scrubs. A mekasim model opens as it is.

The skeleton has the header, the source in the editor mekasim has (moved to
`packages/ui/src/editor` and given its text, messages and callbacks as properties)
with the messages under it, the sheet, and the Run panel with playback and the
model's plots. Still to come as their phases need them: the side panel and the tools. Dividers between the panels and a first Geometry tab
(drawings with their layers, who uses them, the import report, attach and replace)
are there; picking outlines on the sheet is not.
"Open in mekasim" needs `VITE_MEKASIM_URL` set for the site's build; in the dev
server it points at mekasim's dev server.

Second Netlify site from the same repository: `apps/fit/netlify.toml` with its own
build command (`pnpm build:fit`) and publish folder; the site is set to read that
file. Same unlisted, `noindex` setup as mekasim.

## 3. Geometry (phases 1–2)

### 3.1 Shapes

```ts
type Segment =
  | { kind: "line"; ax: number; ay: number; bx: number; by: number }
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; sweep: number }; // sweep > 0 anticlockwise
interface Loop { segments: Segment[] }        // closed, end of each = start of next
interface Shape { outer: Loop; holes: Loop[]; tree: Tree; bounds: Box; radius: number }
```

- In the body frame, in metres. Outer loop anticlockwise, holes clockwise
  (normalised on compile).
- `holes:` entries become full-circle arcs.
- `radius` is the largest distance of the shape from the body frame origin; used for
  quick rejection and as the length scale of the body's angle (§5.3).
- Path text: a small hand-written parser. Arcs in SVG endpoint form are converted to
  centre form with the standard formulas; an arc whose radius is too small for its
  chord is an error (SVG would scale it up; here it means a broken export).
- Validation, with the place reported: open outline, outline crossing itself or
  another, hole outside the outer outline, zero-length segment.

### 3.2 Exact distance

`nearest(a: Segment, b: Segment) -> { d, pa, pb }`, exact for all four pairs:

- line–line: the four endpoint-to-segment distances; 0 with the crossing point when
  they cross.
- line–arc: project the circle's centre on the line; the nearest point on the
  circle in that direction counts if it lies within the arc's span and its foot
  within the segment; then the line's endpoints against the arc and the arc's
  endpoints against the line. Crossings: line–circle intersections within both spans.
- arc–arc: along the line of centres (both directions, for the near and far side);
  each candidate counts if within both spans; then endpoints against the other arc.
  Crossings: circle–circle intersections within both spans.
- point–arc: the point on the circle towards the point if within the span, else the
  nearer endpoint.

`gap(shapeA, poseA, shapeB, poseB)`:

1. Bring B into A's frame (one transform for a whole query).
2. Reject at once if the bounding circles are further apart than the current best.
3. Walk both trees, pruning box pairs further apart than the best so far.
4. If any segments cross, or one shape contains a point of the other (holes
   respected), the shapes overlap. The negative value is the deepest overlap: the
   largest distance, among vertices and arc extremes of each shape inside the other,
   to the other's boundary. Exact enough for the small overlaps that matter;
   documented as an estimate for large ones.
5. Return the distance and the two nearest points, in world coordinates.

Lengths are compared with `1e-12 m` scaled by model size. Every primitive is tested
against a brute-force version on finely divided segments, with random cases from
the seeded generator of §6.2.

### 3.3 Several nearest points per pair

The contact step needs every place two shapes are about to touch, not only the
nearest: a knuckle face against another can touch at both ends.

`contactPoints(A, B, margin)` returns up to four points per pair:

1. For every pair of segments closer than `margin` (default 2 mm), take their
   nearest points.
2. Keep only local minima: drop a candidate if a neighbouring segment pair on the
   same boundaries gives a smaller distance within `merge` (0.2 mm) along the
   boundary.
3. Keep the four smallest. Each carries the distance, the two points and the unit
   normal from A to B (for crossing segments, the normal of the deeper side).

### 3.4 Import

- DXF: a small reader for the ASCII format (group code and value pairs), the
  entities listed in §1, `$INSUNITS` for the unit (asked for when missing). Blocks
  are expanded. Text, dimensions and hatches are skipped and counted in the import
  report. No dependency.
- SVG: `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, with transforms;
  Béziers are fitted with arcs.
- Fitting: biarcs within 0.002 mm (a setting per file in the Geometry tab).
- Loops: join ends within 1e-6 mm with a grid hash, drop zero-length and duplicate
  segments, walk into closed loops, report open chains with their ends, offer to
  close gaps up to a chosen size, nest by containment. Loops are kept in order of
  area, so a re-import of an edited drawing lists them the same way.
- Files are not converted into the YAML. `load(text, files)` takes the model text and
  a map of file name to contents; `files.ts` reads each file named in `geometry:`
  once, then gives each body its outline:
  - `layer`: the closed outlines on that DXF layer (or SVG group id). If there is
    more than one outer outline, `at` is needed.
  - `at: [x, y]`: the outer outline that contains this point (in the file's
    coordinates), with the holes inside it.
  - Outlines are in the file's coordinates, which are world coordinates for a body
    written as drawn. For a body described by dimensions, `place` (an `[x, y, angle]`
    in the file) gives where the body's frame sits in the drawing.
- A missing file or layer is a message pointing at the line; the model still loads
  and solves, without that shape, so the motion stays visible while a file is being
  attached.
- Share links (`@mekasim/ui` `io/share.ts`) carry the YAML with every
  `shape: { from: ... }` replaced by the `path` and `holes` it resolved to, so a link
  opens without the files. Saving to disk keeps the references.
- Open and save: in Chromium-based browsers a folder holding the YAML and its files
  (File System Access API); "Follow file" polls a file's `lastModified` every second
  while the tab is visible. Elsewhere, and for sending, a `.zip` of the same, made with
  `fflate` (small, no other dependencies). Opening accepts the YAML with its files
  picked together, a folder, or a `.zip`. The browser keeps the last model with its
  files in IndexedDB, as mekasim keeps its last model.
- The command line resolves files relative to the YAML's folder.

## 4. Contacts and clearance (phase 2)

- `contacts:` compiles to a list of body index pairs (`among` expanded, duplicates
  removed). Names without a `shape` are reported.
- `gap(a, b)` is a signal measure computed per sample from the solved poses, for any
  two bodies with shapes, listed in `contacts` or not.
- After a run of a model with contacts but no contact solving, every pair is
  checked; the first overlap deeper than 0.001 mm gives a message: "`knuckle` runs
  into `head` at step 41, 0.3 mm deep", pointing at the contacts entry.
- Contacts fold: per pair, the smallest gap over the run, its step, its nearest
  points. Computed in the same pass as the measures.
- "Find contacts": every pair of bodies with shapes whose gap comes under a chosen
  distance at any sample, with the pairs already listed checked.

## 5. The contact step (phase 3)

### 5.1 What is solved

At each sample the mechanism is in equilibrium: the springs' energy is as low as the
joints, drivers, stops, locks and contacts allow. With

- `q` the coordinates of all moving bodies (`x, y, phi` per body, as in core),
- `Phi(q, t) = 0` the joints and position-driven stages (core's constraints),
- `g(q) >= 0` the one-sided constraints: gaps of contact points, stops, locks in,
- `E(q)` the spring energy minus the work of `pull` forces,

each sample solves

```
minimise   E(q) + (eps / 2) * |q - q_prev|_W^2
subject to Phi(q, t) = 0,  g(q) >= 0
```

The second term keeps bodies that nothing holds where they were: a little
resistance to being moved, like friction in a pin. `eps` is small enough that it
does not move where a sprung body settles by more than 1e-6 of its travel.

### 5.2 Sequential steps

Starting from the previous sample's `q` (extrapolated as core's `solveCycle`
does), repeat up to 30 times:

1. Evaluate `Phi` and its Jacobian `J` (core), the spring gradient and Gauss-Newton
   Hessian, and the one-sided rows: for each contact pair, the points of §3.3 with
   `g = d` and gradient `n · (dpB/dq - dpA/dq)`; for each stop and engaged lock, the
   joint value minus its limit.
2. Solve the quadratic program for the step `dq`:
   ```
   minimise   1/2 dq' (H + eps W) dq + (grad E + eps W (q - q_prev))' dq
   subject to J dq = -Phi,   G dq >= -g
   ```
3. Take the step. Stop when `|Phi| < 1e-10`, every `g > -1e-9 m` and `|dq|_W` is below
   1e-10 of the model size.

### 5.3 The quadratic program

- Equalities are removed with the null space of `J` from core's SVD:
  `dq = dq0 + N z`, with `dq0` the minimum-norm step core's solver takes. Redundant
  joints, common in real models, are handled as they are in mekasim.
- What is left is a small strictly convex problem in `z` with inequalities only,
  solved with the Goldfarb–Idnani dual active-set method, dense, in plain TypeScript
  (`qp.ts`). Sizes are tens of variables and constraints.
- `W` weights each body's angle by its shape `radius` squared, so that a turn and a
  shift of similar size on the sheet weigh alike.
- If the program has no solution, the step is a jam candidate (§5.7).

### 5.4 Stops and locks

- A stop is a one-sided row while its joint is within `margin` of it.
- A lock is checked after each accepted sample: if the joint value has passed `at`
  in the `drops` direction since the previous sample, the lock is in from the next
  sample on, as a stop at `at`. Its state is part of the sample's output, so
  `latched()` reads it and replay reproduces it.

### 5.5 Springs

`springs.ts` gives energy, gradient and Gauss-Newton Hessian in `q` for torsion
springs (on the relative angle of a revolute joint) and straight springs (on the
distance between two points). Preloads are turned into rest values at compile.

### 5.6 The move driver

- A `to` stage is a pose constraint on the body (three equations, a `Constraint` as
  in core), with the pose interpolated linearly in `x, y, angle`, or along the arc
  through `via`, over the stage's time.
- A `pull` stage drops those equations and adds `-F · x_body` to `E`. If something
  holds the body, the program finds the equilibrium. If nothing does, the body keeps
  moving; when it has moved more than ten times the largest shape size since the
  stage began with no contact force against the pull, the driver "came free" and
  the stage ends there. That is a result, not an error.
- Samples are `cycle.steps` spread over the stages by their time; a sample is split
  in two (up to six times) wherever any point of a body in a contact pair would
  move more than a quarter of the smallest feature size of its shape (against
  tunnelling).

### 5.7 Jams

A sample that does not converge is split in halves, down to 1/64 of its step. If the
last still fails, the run ends with a jam: "Jams at 1.24 s: `b_knuckle` against
`knuckle`, `knuckle` against its stop", listing the one-sided rows active in the
last attempt. Measures and plots cover the samples reached, as mekasim's do for
"locks up at step N".

### 5.8 Forces

After a sample converges, the forces in the active one-sided rows and in the joints
come from the equilibrium `J' lambda + G_active' mu = -grad E` with `mu >= 0`, solved
as non-negative least squares on the active rows (not taken from the regularised
program, whose multipliers include the `eps` term). `force(contact)` is the sum of
its points' `mu`; `force(push)` is the force the pose constraint of the `move`
driver carries. Without springs or pulls every force is zero, and the app says that
forces need springs or a pull to mean anything.

### 5.9 Velocities

A contact run has no velocity solve: the motion is not set by the drivers alone.
Velocities, accelerations and jerks are central differences of the sampled
positions, and the measures of speed say "from positions" in their tooltip.

### 5.10 Choosing the path

`packages/fit/src/simulate.ts` calls core's `simulate` with its hooks. A model with
no springs, locks, stops or `move` driver uses core's own cycle solve; shapes,
contacts and `gap()` work on it all the same. Otherwise the contact step replaces
the cycle solve and returns a `Cycle`, so core's measures and plots work on it.

## 6. Studies (phase 4)

### 6.1 One run

`runStudy(text, study, index) -> RunResult` in `study/run.ts`:

1. Draw the values for run `index` (§6.2). Geometry files are read once per worker,
   not per run; the text is what changes between runs.
2. Write them into the text with core's `editText`, keeping bounds, as core's
   `sweep()` does.
3. `simulate()` the edited text.
4. Evaluate the conditions: the study's `pass` when it has one, otherwise the
   model's `checks`. They hold as a check does in mekasim (a single value must not
   be 0, a signal must not be 0 at any sample), through the same code, so a run
   shown on the sheet has the checks its outcome was counted from.

```ts
interface RunResult {
  index: number;
  values: Record<string, number>;      // SI
  outcome: "passed" | "failed" | "unsolved";
  failed: string[];                    // conditions that did not hold
  message?: string;                    // for unsolved: the solver's message
  numbers: Record<string, number>;     // each condition's value, 1 or 0
  ms: number;
}
```

### 6.2 Drawing values

- `random.ts`: `splitmix32(seed)` seeds a xoshiro128** generator; normal values by
  Box–Muller; `pick` by index.
- `spread`: a Latin hypercube for all runs at once, from the seed: each range is cut
  into `runs` equal parts, each used once, in an order shuffled per parameter.
  Values of run `i` depend only on the text, the study and `i`, never on how many
  workers ran it or in which order.
- `grid`: every combination; `runs` is ignored and the count shown.
- A normal range is cut off at the parameter's bounds by redrawing (at most 64
  times, then clamped).

### 6.3 Running many

- App: a pool of module workers (`navigator.hardwareConcurrency - 1`, at least 1).
  Each receives the model text, its geometry files and the study name once, then batches of 8 run
  indices, and posts results back. The store takes them as they come; the results
  tab redraws at most four times a second. "Stop" ends the workers and keeps what
  has run.
- Command line: `pnpm fit:study <model> <study> [--runs N] [--csv out.csv]`, with
  `node:worker_threads`, printing the summary of §6.4. This is how studies are
  tested end to end without a browser.
- Results are kept in IndexedDB per hash of the model text and its geometry files,
  and study name, so reopening a
  model shows its last results. When the text changes, the previous results stay as
  "before" until a new run finishes.

### 6.4 What is shown

- Share passed, with the Wilson 95% interval, over passed and failed; unsolved runs
  counted and listed apart.
- For each varied parameter, the pass rate in ten bins of its range (or per picked
  value).
- The two parameters whose bins differ most in pass rate are the scatter's default
  axes; any two can be chosen.
- Failures by condition, largest first; clicking one filters the scatter.
- Before and after: both pass rates, and the earlier failures as hollow crosses.

### 6.5 Replay

Clicking a run writes its values into an in-memory copy of the text (the source is
not changed), simulates it on the main thread and shows it on the sheet and in the
Run tab. The store holds `{ study, index }` while a run is shown. A replay that does
not give the stored outcome is a bug; the panel says so, and a test checks it.

"Use these values" writes them into the source, as a parameter slider would.

## 7. The app

Layout as described in PLAN.md §5. Following mekasim's code:

- Session state (selection, tool, left panel tab, shown run, study progress) lives in
  `apps/fit/src/store.ts` (Zustand), never in the document.
- Edits from the sheet go through core's `edit/operations.ts`, so comments and order
  in the source survive.
- Colours from `@mekasim/ui` only. Shapes take the body tones; a gap is drawn in dye
  blue like mekasim's `dist`; overlaps and failures in red; a lock as a small brass
  marker on its joint, filled when in.
- Charts: `@mekasim/ui`'s plot code; the scatter is added there with its geometry in a
  plain module with tests.
- Keys: V select, P pin, K contact, D measure, F fit, Space play, arrows step,
  Ctrl+Z undo, as in mekasim where they overlap.
- Help text in the app, and an AI skill text like mekasim's `skill/SKILL.md` for
  mekafit's format, grow with each phase.
- Small screens: as mekasim, watch only.

## 8. Tests

Without a browser. Per phase:

**0 Split.** Example baseline and schema identity (§2.2); each moved module's tests
moved with it; the shared splitter's sizes and keys through its props; extension
points: with and without, same results; the sheet's view
transform, grid and label placement; mekafit loads a mekasim example and solves it to
mekasim's numbers.

**1 Shapes.** Path parse and write round trip; arcs from SVG endpoint form against
known centres; validation messages with places; the DXF reader on small files
written in the tests (one per entity type, units, blocks); loops: gaps, T-ends,
nesting; resolving `from` by layer, by `at` and with `place`; a missing file or layer
gives its message and the model still solves; share-link flattening gives the same
shapes as the files; `.zip` save and open round trip (in Node, with fflate); `copy`
names and transforms; shape export gives the same outline back.

**2 Clearance.** Each `nearest` pair against brute force on 10 000 seeded random
cases; known cases: concentric arcs, tangent circles, line through arc, spans just
missing; a pin in a hole gives its clearance; overlap depth of pushed-together
squares; a motor-driven knuckle with a known smallest gap.

**3 Contact.** The QP against hand-solved problems, including degenerate ones; a
block pushed onto a wall stops at it; a sprung lever pushed by a moving bar follows
and returns; a lock drops in and holds; a pull on a held body finds the equilibrium
and its force equals the spring's; a pull on a free body comes free; a jam names the
right pair.

**4 Studies.** The generator against published xoshiro128** values; the Latin
hypercube fills every bin once; same seed, same draws in any batch order; the Wilson
interval against known values; a three-run study end to end through `pnpm
fit:study`; each replay gives its stored outcome.

**Budgets** (on the CI runner, with a generous factor): `gap` between two
200-segment shapes under 50 µs on average; one contact sample of the coupler under
1 ms; one coupling run under 150 ms.

**Examples.** mekafit's examples go in `examples/fit/` and are solved by a test like
`examples.test.ts`: `knuckle-coupler.mekafit.yaml` (simplified, drawn for the
purpose, not Thomas's design), `ratchet.mekafit.yaml`, `door-latch.mekafit.yaml`,
`clearance-check.mekafit.yaml` (motor-driven, gaps only).

## 9. Order of work

Each step ends with `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` (both
apps) passing. Each phase ends with PLAN.md's status line updated, FORMAT.md marked
for what is built, and a short list for Thomas of what to look at in the dev servers.

**Phase 0.** Baseline and schema tests → `packages/ui` with the store-free modules,
mekasim importing them → **Thomas checks mekasim** → extension points 1–4, each with
its test → `packages/fit` skeleton (load, simulate through core) → the SVG sheet in
`packages/ui` → `apps/fit` skeleton playing a mekasim example → second Netlify site.

**Phase 1.** path.ts and shape.ts → `shape` with `path` in mekafit's schema and compile →
shapes on the sheet → import/ (dxf, svg, loops) → `geometry:` and `shape.from` with
files.ts → share-link flattening → Geometry tab (attach, layers, report, missing files)
→ picking outlines on the sheet into bodies, pins from holes → open and save as folder
and `.zip`, follow file → `copy` → shape export → help text.

**Phase 2.** distance.ts and tree.ts → `gap()` → `contacts:` and the overlap message →
Contacts fold and gap dimensions → Contact tool and "Find contacts" →
`clearance-check` example.

**Phase 3.** Force units (through the expression registry) → qp.ts → inequality.ts and contacts.ts → springs.ts → quasistatic.ts for
`to` stages, then `pull` stages → stops and locks → forces → `force`, `latched`,
`final`, `first` → Springs and locks fold → examples (ratchet, door latch, coupler).

**Phase 4.** random.ts and sample.ts → run.ts → stats.ts → `pnpm fit:study` → workers
and store → Studies fold → Study tab and scatter → replay → before and after.

**Phase 5.** Planned separately once phase 4 is in use; PLAN.md's risks explain why.
