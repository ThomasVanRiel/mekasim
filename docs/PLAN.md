# mekasim — design plan

Status (2026-10-01): **phase 0 is built** (core package, command-line solver, format
reference). **Phase 1, the viewer, is built** but not yet deployed to Netlify.
**Phase 2, the editor, is built.** **Phase 3, analysis, is built.** Phase 4,
components and the refined 3D view, is next.

Phase 3 differs from the plan in two ways. Charts are drawn as plain SVG rather
than with uPlot, so that their geometry can be unit-tested without a browser.
Plots are part of the model (a `plots:` section) rather than session state, so a
shared model arrives with its charts.

Left out of phase 2 for now: renaming things from the drawing (edit the name in the
source), drawing sliders, welds and pin-slots (write them in the source), and a
list of recent models (the last model is kept in the browser; files are opened and
downloaded). The format as implemented is described in
[FORMAT.md](FORMAT.md), which takes precedence over the sketch in section 4.

A browser app for exploring mechanisms: draw or describe linkages, eccentrics, cams
and joints, then watch them move and measure what they do. It is a general tool; a
combine harvester sieve is simply a suitably complex model to prove it on.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Purpose | Check the motion of mechanisms and measure displacements and other quantities. Nothing machine-specific. |
| Mechanism scope | Planar first (several parallel planes linked by shafts). File format is 3D-ready; true spatial joints are a later phase. |
| Physics | Exact kinematics first (position, velocity, acceleration). Then inverse dynamics: joint loads, drive torque, shaking forces. No forward dynamics. |
| Input | Four ways into the same model: sketch with snapping, dimension-driven with named parameters, trace over an image underlay, edit the text source. |
| File format | **YAML** is the native format (`.mekasim.yaml`). JSON is accepted on import and offered on export. |
| Underlays | A drawing aid only, not part of the model and not stored at first. |
| Storage | Local-first, no backend, no accounts: browser autosave, YAML files on disk, share link. |
| Hosting | Netlify, unlisted URL. Repository private for now. |
| Delivery | Static single-page app. |

## 2. Principles

1. **The document is the product.** One human-readable YAML document describes a
   mechanism completely. Canvas, inspector and text editor are all just editors of
   that document.
2. **The solver never sees UI concepts.** `compile(document) -> SolverModel` evaluates
   expressions and expands components into primitives. The solver only knows bodies,
   constraints and drivers.
3. **Exact, not approximate.** Loops close to solver tolerance at every step. No
   game-physics engine.
4. **Explore, do not just draw.** Every number can be an expression over named
   parameters; sliders, sweeps and plots are first-class.
5. **Explain failures.** "Cannot assemble", "1 degree of freedom left, add a motor",
   "redundant constraint" are messages pointing at the offending entities and the
   offending line of YAML, never a silent freeze.

## 3. Architecture

```
packages/core   (pure TypeScript, no DOM, runs in browser, worker and node)
  schema/       document types, validation, migrations, JSON Schema export
  expr/         expression parser + units
  compile/      document -> SolverModel (param evaluation, component expansion)
  solver/       constraints, position/velocity/acceleration, diagnostics, inverse dynamics
  analysis/     cycle sampling, traces, measures, sweeps
apps/web        (React SPA)
  state/        document store, undo/redo, session state
  viewport/     Three.js scene, 2D and 3D cameras, picking, gizmos
  tools/        sketch, joint, dimension, underlay, measure
  panels/       tree, inspector, parameters, plots, source editor, timeline
  io/           IndexedDB autosave, file open/save, share link
examples/       textbook mechanisms, also used as test fixtures
docs/           this plan and the format reference
```

Stack: TypeScript (strict), Vite, React, react-three-fiber, Zustand (state and
undo/redo), `yaml` (parser with comment-preserving edits), CodeMirror 6 (source
panel), uPlot (plots), Vitest, pnpm workspaces. No browser automation: logic is
kept in plain modules with unit tests, and the UI is checked by hand in a dev
server.

State is split three ways:

- **Document** — persisted, undoable.
- **Session** — selection, active tool, camera, current time, underlays. Not in the file.
- **Derived** — compiled model and the solved cycle. Recomputed, never stored.

## 4. Document format

YAML 1.2, compact enough to write by hand, keyed by id so diffs are readable.
Expressions need no quoting.

```yaml
mekasim: 1
meta:
  name: Four-bar with coupler point
  units: { length: mm, angle: deg }

params:
  r: 40 mm          # crank radius
  rpm: 300

bodies:
  ground:
    points: { O2: [0, 0], O4: [180, 0] }
  crank:
    points: { O: [0, 0], A: [r, 0] }
    layer: 0
  coupler:
    points: { A: [0, 0], B: [160, 0], P: [80, 60] }
    layer: 1
  rocker:
    points: { B: [0, 0], O: [110, 0] }
    layer: 0

joints:
  main:    { type: revolute, connect: [ground.O2, crank.O] }
  pin_a:   { type: revolute, connect: [crank.A, coupler.A] }
  pin_b:   { type: revolute, connect: [coupler.B, rocker.B] }
  rock:    { type: revolute, connect: [rocker.O, ground.O4] }

drivers:
  motor: { joint: main, speed: rpm }

traces: [coupler.P]

measures:
  stroke_x:    range(x(coupler.P))
  rocker_swing: range(angle(rocker))
  peak_accel:  max(abs(a(coupler.P)))

pose:               # last solved position, written by the app
  crank: [0, 0, 0]
```

Notes:

- A body is a rigid set of named points in its own frame. Link dimensions are the
  distances between those points. `ground` is the fixed body.
- Joints connect points as `body.point`.
- `pose` stores the last solved position. It is the initial guess on load, which
  keeps the assembly branch (open vs crossed) stable between sessions. It is
  optional; when writing a file by hand it can be left out or given roughly.
- `layer` and an optional thickness and outline give the depth used by the 3D view.
  Bodies sit on a plane; in phase 1 all planes are parallel.
- Components (section 6) appear as their own entries with parameters; they are
  expanded at compile time and are not stored as primitives.
- `mekasim: 1` is the format version; loading runs migrations forward.
- Comments and key order survive edits made from the canvas: the app patches the
  YAML syntax tree rather than re-serialising the whole document.
- A JSON Schema is generated from the same type definitions. It drives validation
  and autocomplete in the source panel, and works in external editors through the
  YAML language server.
- A format reference (`docs/FORMAT.md`) with every joint type, field and measure
  function is a phase 0 deliverable, since hand-written YAML is a primary input.

Measure vocabulary (initial): `x(p)`, `y(p)`, `dist(p, q)`, `angle(body)`,
`angle(p, q, r)`, `v(p)`, `a(p)`, `omega(body)`, `alpha(body)`; over a cycle:
`min`, `max`, `range`, `mean`; plus ordinary arithmetic and parameters.

## 5. Solver

Classic constraint formulation (Haug / Nikravesh).

- Coordinates: `q = [x, y, phi]` per moving body. Ground is eliminated.
- Each joint contributes constraint equations `Phi(q, t) = 0`: revolute 2,
  slider 2, weld 3, pin-in-slot 1, distance 1, gear ratio 1, belt 1, cam contact 1
  (plus a curve parameter), driver 1.
- **Position:** Newton iteration with a line search on `Phi`, started from the
  previous pose. Each step is the minimum-norm least-squares one (direct solve when
  the Jacobian is square and regular, singular value decomposition otherwise), so
  redundant constraints, free motion and near-singular poses are tolerated.
- **Velocity and acceleration:** linear solves with the same Jacobian.
- **Diagnostics:** Jacobian rank gives the true degrees of freedom and identifies
  redundant constraints; a failed solve reports which constraints have residual left.
- **Dragging:** with free degrees of freedom, the cursor becomes a weighted soft
  constraint, so parts can be pulled around while every joint stays closed.
- **Inverse dynamics (later):** `M q'' + Phi_q^T lambda = Q` gives joint reactions and
  driver torque from the multipliers; ground reactions sum to the shaking force.
- **Spatial (later):** constraints implement one interface (residual + Jacobian rows
  against body coordinate blocks), so a spatial body block and spatial joints can be
  added without changing the solve loop.

Jacobians are hand-written and every one is checked against finite differences in
tests. Models are tens of bodies, so dense linear algebra in plain TypeScript is
enough: the seven-body shaker example solves a full 360-step cycle, measures
included, in about 12 ms. The solver runs on the main thread for interactive use and
in a worker for sweeps.

Internal units are SI (m, rad, s, kg). Display units default to mm, deg, rpm.

## 6. Components

Primitives: body, revolute, slider, weld, pin-in-slot, distance, gear, belt/chain,
cam contact, motor (constant speed or expression of time).

Components are parametric macros that expand to primitives:

| Component | Parameters | Expands to |
|---|---|---|
| Eccentric shaft | throws with radius and phase, shaft position | one body with a point per throw, revolute to ground, optional motor |
| Connecting rod / pitman | length | two-point body |
| Rocker / hanger / bellcrank | arm lengths, included angle | two- or three-point body with a ground or body pivot |
| Cam and follower | profile (points/spline or motion law), follower type | cam body, cam-contact constraint, follower body |
| Slot | path (line or arc) | pin-in-slot constraint |
| Gear pair, belt drive | ratio or tooth counts / diameters | angle-coupling constraint |

Adding a component means writing its parameter schema, its expansion and its
visuals. The solver is untouched.

## 7. Editor

Layout: tool rail and model tree on the left, viewport in the centre (2D / 3D / split),
inspector and parameters on the right, timeline and plots along the bottom, source
panel as a toggle.

- **Sketch:** click points to create a link, click a coincident pair to pin it,
  click ground to anchor. Snaps to points, grid, horizontal/vertical. Type a length
  while drawing to fix it.
- **Dimension-driven:** every numeric field accepts an expression. Parameters panel
  with sliders; dragging a slider re-solves live.
- **Source:** YAML in CodeMirror with schema validation, autocomplete and errors on
  the offending line. Both directions go through the same edit path; while the text
  is invalid the last valid model stays on screen.
- **Underlay:** drop in an image, calibrate scale by picking two points and entering
  the real distance, set opacity, lock. Session only: gone on reload, never in the
  file or the share link. Persisting it locally can be added later if it is missed.
- **2D and 3D:** one Three.js scene. 2D is an orthographic camera locked to the
  sketch plane, 3D is an orbit camera showing links as extruded plates by layer,
  pins and shafts as cylinders.

## 8. Analysis

This is the point of the tool, so it arrives early (basic measures in phase 1).

- Point traces (coupler curves), velocity and acceleration vectors on any point.
- Measures as expressions, shown as live values and as a results table over a cycle.
- Interactive measuring: pick two points or two links for distance or angle.
- Plots against driver angle or time; several signals per plot.
- Parameter sweeps overlaying curves for several values.
- CSV export of any plot or the results table.

## 9. Storage, sharing, hosting

- Autosave to IndexedDB with a recent-models list.
- Open/save `.mekasim.yaml` through the File System Access API, with download/upload
  fallback for Firefox and Safari. Import and export JSON.
- Share link: the YAML text, comments included, compressed into the URL fragment.
  The fragment never reaches a server.
- Netlify static deploy from the private repository, on an unlisted site name, with
  `noindex` headers. An unlisted URL is obscurity, not access control: anyone with
  the link gets the app. Models stay in the user's browser either way.

## 10. Phases

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 ✓ | Core | Schema, YAML loading, expressions and units, compile, planar solver (revolute, slider, pin-slot, weld, motor), diagnostics, measures, format reference | A node script solves a YAML model over a full cycle and prints its measures; four-bar and slider-crank match closed-form results |
| 1 | Viewer | App shell, load and render, play and scrub, traces, live measures, YAML source panel, basic 3D camera, Netlify deploy | Editing YAML animates the mechanism in 2D and 3D and updates its measures |
| 2 | Editor | Sketch tools, snapping, drag-to-pose, inspector, parameters and sliders, undo/redo, autosave, files, share link | A four-bar can be built from scratch with the mouse in under a minute, and the resulting YAML is clean |
| 3 | Analysis | Plots, interactive measuring, sweeps, CSV, session underlay | Displacement, velocity and acceleration of any point plotted and exported |
| 4 | Components | Eccentric shaft, cam and follower, slot, gears, belt; refined 3D view | A multi-loop model built from components instead of raw primitives |
| 5 | Forces | Mass properties, gravity, inverse dynamics, reaction and torque plots, springs as applied forces | Drive torque and shaking force over a cycle |
| 6 | Spatial | 3D joints, non-parallel planes, spatial solver | A spatial four-bar (RSSR) solves and animates |

Phase 1 comes before the drawing tools on purpose: because the YAML source is an
input mode, real models can run end to end before the hardest UI work starts.

The complex acceptance model (the sieve) is supplied as YAML by Thomas when a phase
is ready to be tested against it; it gates nothing.

## 11. Risks

- **Assembly branches and dead points.** Mitigated by pose continuation and explicit
  diagnostics; needs careful UX when a dimension edit makes assembly impossible.
- **Crisp 2D in WebGL.** Lines, dimensions and labels must look like a drawing, not a
  game. To be proven with a spike early in phase 1; fallback is an SVG overlay for
  annotations.
- **Two-way YAML and canvas sync.** Preserving comments and layout through canvas
  edits depends on patching the syntax tree correctly; needs its own test suite.
- **YAML surprises.** Parsed strictly as YAML 1.2 so `no`, `on` and similar stay
  strings; duplicate keys are an error.
- **Cams.** Contact is modelled as always closed; lift-off is out of scope for
  kinematics.
- **Scope.** The component library can grow without limit; build what real models
  need.

## 12. Open questions

1. Licence: to be chosen when the repository goes public.
2. Which components come first in phase 4, decided by the first real models.
