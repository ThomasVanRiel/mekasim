# mekafit — design

Technical design for the phases of [PLAN.md](PLAN.md), written for whoever builds
them, person or coding agent. The format is in [FORMAT.md](FORMAT.md). The
conventions of the repository's [CLAUDE.md](../../CLAUDE.md) apply throughout:
TypeScript run directly by Node in the packages (no `enum`, no parameter
properties, `.ts` in relative imports), no DOM in `packages/core` or
`packages/fit`, Vitest for everything that can be tested without a browser, no
Playwright.

## 1. Where the code goes

As built, with what is still to come marked "(to come)". Shapes and drawings were
first planned for `packages/fit`; they are mekasim's too, so they are in the shared
packages.

```
packages/core/src            mekasim's core
  geometry/
    shape.ts      Segment (line | arc), Loop, Shape; area, bounds, placement, containment
    path.ts       parse and write path text (M L H V A Z)
    intersect.ts  where two segments meet
    validate.ts   checks on outlines; a shape from its loops
    outline.ts    the plate round a body's points (mekasim's from the start)
    fit.ts        splines and ellipses replaced by arcs within a tolerance
    distance.ts   exact nearest points between segments and between shapes; `gap`
    tree.ts       bounding-box tree over a shape's segments
  analysis/gaps.ts  the gap between two bodies over the motion; `gap(a, b)` is in measures.ts
  drawing/
    read.ts       DXF entities -> segments by layer (LINE ARC CIRCLE LWPOLYLINE POLYLINE INSERT)
    loops.ts      join ends into closed loops, report open ones, nest outlines and holes
    resolve.ts    `geometry:` and `shape.from` -> path text; kept outlines; names for drawings
    write.ts      shapes to DXF with true arcs
    disk.ts       a model's drawings from beside it, for the command line and tests
  simulate.ts     takes `files`, and the hooks of §2.3
packages/fit/src
  schema.ts       mekafit document: mekasim's schema with `mekafit: 1` and `contacts:`
  load.ts         reads `mekafit: 1` and `mekasim: 1` files; `asMekasim`
  simulate.ts     core's pipeline with mekafit's schema and extension hook
  registry.ts     force, torque and stiffness units added to mekafit's expressions
  contacts.ts     checked pairs; gaps over a run, closest results and overlap messages
  edit.ts         additions to `contacts:` made by the tool and finder
  compile.ts      core's `prepare` and `extend` hooks: contacts, springs, move drivers, stops and locks
  geometry/
    contacts.ts   several nearest points per pair of shapes, for the contact step
  solver/
    inequality.ts one-sided constraints: contact, stop and lock rows
    qp.ts         small dense quadratic program (dual active set)
    springs.ts    spring energy, gradient and Gauss-Newton Hessian
    stages.ts     a move's pose over its stages, and the constraint that holds it there
    quasistatic.ts the contact step and the stage-driven run
  measures.ts     force, torque, latched, final, first (through core's registry)
  (to come)
  copy.ts         the `copy` component, expanded in core's `prepare` hook
  study/
    random.ts     seeded generator (splitmix32 seeding xoshiro128**)
    sample.ts     random, spread (Latin hypercube), grid
    run.ts        one run: draw -> edited text -> simulate -> pass/fail
    stats.ts      pass rate with Wilson interval, per-parameter rates, telling parameters
  cli.ts          `pnpm fit:solve` and `pnpm fit:study`, studies in worker_threads
packages/ui/src
  theme.ts, theme.css          colours, fonts and the page's base styles
  names.ts                     names from the model as words
  Fold.tsx, Splitter.tsx, Choice.tsx, Tabs.tsx
  editor/         the YAML source editor, taking its text and messages as properties
  plot/           Chart.tsx, charts.ts, geometry.ts
  io/             share.ts, download.ts
  scene.ts        what is drawn of a model, for mekasim's Three.js view and the sheet alike
  sheet/          SVG sheet: pan, zoom, grid, labels, dimensions
  drawings/       the Geometry tab, the picture of a layer, the handling of picked files
apps/fit/src
  store.ts        model text, drawings, solved run, playback
  examples.ts     mekafit's own examples from `examples/fit`, with their drawings
  layout.ts       sizes of the panels
  playback.ts     how the position in a run moves on
  App.tsx         layout (§7)
  sheet/Drawing.tsx   the mechanism on the sheet, shapes with true arcs
  panels/         Header, Source (tabs Source and Geometry, messages), Run, Contacts and finder
  sheet/          SVG mechanism drawing and the Select and Contact tools
  panels/SpringsLocks, springs.ts   the Springs and locks fold and its wording
  (to come)       Inspector, Studies, Parameters, StudyResults,
                  io/project.ts (folder or `.zip`), study/ (worker, runner, scatter)
```

Package names: `@mekasim/core`, `@mekasim/fit`, `@mekasim/ui`, and the apps
`@mekasim/sim-web` and `@mekasim/fit-web`. Root scripts: `dev`, `build` (both apps),
`dev:sim`, `dev:fit`, `build:sim`, `build:fit`; `fit:solve` and `fit:study` are to
come. `pnpm test`, `typecheck` and `lint` cover every package.

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
   driver, not a field on mekasim's. It needed no way of its own into `extra`:
   mekafit gives the `drivers` section again among its sections, with mekasim's
   driver (taken from `Document`) or a move, and its `prepare` hook sets the moves
   aside under `moves` before core compiles the drivers it knows.
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
   normal: the way B goes to get clear of A. A corner that touches a face is held
   square to the face.

Where the shapes are into each other the distance is less than nothing and the
normal keeps its direction, so the contact step pushes them apart again: two
boundaries that have passed each other are told by their outward directions, and a
corner or bulge inside the other shape is measured by core's `gap`, in place of the
crossings round it. Two flat faces that lie along each other, facing, give the two
ends of the stretch they share with the distance between the faces; their nearest
points alone would be one arbitrary place, with no direction once they touch.

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
  two bodies with shapes, listed in `contacts` or not. It is mekasim's (Thomas asked
  for it there too). Two bodies joined by a pin are never counted as overlapping:
  their gap is 0 where they lie over each other, with a warning (Thomas's decision;
  the design is drawn to suit). The check on `contacts:` follows the same rule.
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

Starting from the previous sample's `q`, repeat up to 30 times (not from where the
bodies seemed to be going, as core's `solveCycle` does: a part that has just been
let go would be carried past where it comes to rest, onto another branch):

1. Evaluate `Phi` and its Jacobian `J` (core), the spring gradient and Gauss-Newton
   Hessian, and the one-sided rows: for each contact pair, the points of §3.3 with
   `g = d` and gradient `n · (dpB/dq - dpA/dq)`; for each stop and engaged lock, the
   joint value minus its limit.
2. Solve the quadratic program for the step `dq`:
   ```
   minimise   1/2 dq' (H + eps W) dq + (grad E + eps W (q - q_prev))' dq
   subject to J dq = -Phi,   G dq >= -g
   ```
3. Take the step, cut short where it would carry a body of a contact pair further
   than it may go in one sample (§5.6): the step is laid out for the parts as they
   touch now, and a longer one could pass what is in its way. Stop when
   `|Phi| < 1e-10`, every `g > -1e-9 m` and `|dq|_W` is below 1e-10 of the model size.

Near a position where the joints and contacts are met, a step is also halved until
the energy follows what the step expects of it (down by at least a tenth of that,
or up by no more than nearly twice it where the constraints force it up).

The first sample closes the joints from the pose as mekasim does, then settles the
springs and contacts with up to 400 such steps, since a spring may carry a part a
long way before it rests. `eps` is 1e-6 of the softest spring's stiffness (a torsion
spring's over the square of its body's reach), or 1 where there are no springs.

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

- A stop is a one-sided row on its joint's value: the angle of a revolute joint,
  its second body's less its first's, or the travel of the pin along a slider or
  slot from the first point of its axis. Each end is always a row; there are few
  of them, and one that is far from its limit costs nothing.
- A lock is checked after each accepted sample: if the joint value has passed `at`
  in the `drops` direction since the previous sample, the lock is in from the next
  sample on, as a stop at `at`. Its state is part of the sample's output, so
  `latched()` reads it and replay reproduces it. A lock that is `engaged` is in from
  the start. Nothing lets a lock out again.

### 5.5 Springs

`springs.ts` gives energy, gradient and Gauss-Newton Hessian in `q` for torsion
springs (on the relative angle of a revolute joint) and straight springs (on the
distance between two points). Preloads are turned into rest values at compile,
from the position in which the joints close at time 0 starting from the pose. A
positive straight-spring preload is tension, pulling the points together; a
positive torsion preload acts in the joint's positive-angle direction. Negative
preloads act the other way. To the Gauss-Newton Hessian is added the stiffness a
stretched straight spring has sideways of its line, its tension over its length;
without it a spring pulled across a slider never settles. The same term of a spring
pushed short is left out, and so is how a turning body carries the spring's end
round, so the Hessian is never negative. A straight spring whose two points are on
one place has no direction and adds no gradient there.

### 5.6 The move driver

- A `to` stage is a pose constraint on the body (three equations, a `Constraint` as
  in core), with the pose interpolated linearly in `x, y, angle`, or along the arc
  through `via`, over the stage's time.
- A `pull` stage drops those equations and adds `-F · x_body` to `E`. If something
  holds the body, the program finds the equilibrium. If nothing does, the body keeps
  moving. So that it moves on evenly and not all at once, a one-sided row of the
  run's own lets it go only so far along its pull in each sample: at a pace that
  takes it ten times the model's size over the stage. A pull in which that row was
  the only thing against the body in every sample "came free". That is a result,
  not an error: an `info` message, and `free` on the simulation.
- The stage after a pull begins where the pull left the body. Each stage's end is
  a sample, so that this place is one the run has solved.
- The run has `cycle.steps` intervals spread over the stages by their time, at
  least one in each, so one sample more than there are intervals, the start and
  the end both among them. A sample is split
  in two (up to six times) wherever a body in a contact pair has moved more than a
  quarter of its shape's thickness (against tunnelling); this is seen once the
  sample is solved, and the added samples are part of the result. The thickness is
  twice the outline's area over its length: a long bar's width, a disc's radius.
- Without a `move` driver the run lasts the model's period, sampled the same way.

### 5.7 Jams

A sample that does not converge is split in halves, down to 1/64 of its step (the
same splitting as against tunnelling). If the
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

As built: `mu` is found first, in the directions the joints leave free, where only
the rows can answer, among the rows within a micrometre of touching; `lambda` then
takes what is left. Where balance does not settle how several places share a force,
as the two ends of a flat face, they get the least forces that hold, so the sum
reported for such a contact is one of the values that balance allows. A spring's
load is counted as its preload is. In a `pull` stage the driver's force is the pull
itself. `torque(name)` gives a torsion spring's torque, a move's about its body's
origin, and a motor's; asking `force` of something that turns, or `torque` of
something that pushes, says which to use. A name that is two of a contact, a spring
and a driver is refused, since they are named apart in the model.

### 5.9 Velocities

A contact run has no velocity solve: the motion is not set by the drivers alone.
Velocities, accelerations and jerks are central differences of the sampled
positions, and the measures of speed say "from positions" in their tooltip.

### 5.10 Choosing the path

`packages/fit/src/simulate.ts` calls core's `simulate` with its hooks. A model with
no springs, locks, stops or `move` driver uses core's own cycle solve; shapes,
contacts and `gap()` work on it all the same. Otherwise the contact step replaces
the cycle solve and returns a `Cycle`, so core's measures and plots work on it.
Each move is a pose constraint in the compiled model, so its body counts as driven,
and the model's period is the time the moves take. mekasim's warning that a part is
not driven is dropped in a contact run, where springs and contacts hold such parts.

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
`clearance-check.mekafit.yaml` (motor-driven, gaps only),
`push-latch.mekafit.yaml` (Thomas's idea: a push-to-open catch as in a drawer, a
pin riding in a heart-shaped slot, which rests in one of two places and goes from
one to the other with each push).

## 9. Order of work

Each step ends with `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` (both
apps) passing. Each phase ends with PLAN.md's status line updated, FORMAT.md marked
for what is built, and a short list for Thomas of what to look at in the dev servers.

**Phase 0.** Done, but for making the second Netlify site: baseline and schema
tests, `packages/ui`, the extension points, the `packages/fit` and `apps/fit`
skeletons, the SVG sheet.

**Phase 1.** Done, in core and ui where mekasim shares it: path.ts and shape.ts →
`shape` with `path` → shapes on the sheet (and in mekasim's 3D view) → DXF reading
and loops → `geometry:` and `shape.from` → outlines kept in the model for saving
and links → Geometry tab (attach, replace, layers with pictures, report) →
`shapesToDxf` → splines and ellipses as arcs (biarc fitting within `fit`). Still to
do, in this order unless Thomas says otherwise: SVG drawings → picking outlines on
the sheet into bodies, pins from holes → saving the drawings with the model (folder
or `.zip`), follow file → `plate: true` → `copy` → true arcs in the parts' DXF →
help text.

**Phase 2.** distance.ts and tree.ts → `gap()` → `contacts:` and the overlap message →
Contacts fold and gap dimensions → Contact tool and "Find contacts" →
`clearance-check` example.

**Phase 3.** Force units (through the expression registry) → qp.ts → inequality.ts and contacts.ts → springs.ts → quasistatic.ts for
`to` stages, then `pull` stages → stops and locks → forces → `force`, `latched`,
`final`, `first` → Springs and locks fold → examples (ratchet, door latch, coupler).

**Phase 4.** random.ts and sample.ts → run.ts → stats.ts → `pnpm fit:study` → workers
and store → Studies fold → Study tab and scatter → replay → before and after.

**Phase 5.** Planned separately once phase 4 is in use; PLAN.md's risks explain why.
