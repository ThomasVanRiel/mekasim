# mekafit — plan

Status (2026-10-13): phase 0 built but for its second Netlify site, which is
described in `apps/fit/netlify.toml` and still has to be made in Netlify. Phase 1 is
under way: outlines, path text and DXF reading are built. mekasim gained `checks:`,
comparisons and `shape` written as path text on the way; mekafit builds on all
three. "mekafit" is a working name.

mekafit is a second app in the mekasim repository. mekasim stays as it is: its app,
its format and its behaviour do not change. mekafit shares mekasim's solver,
expressions and units, and its look, and adds what mekasim deliberately leaves out:
real part shapes, clearance between them, parts that push each other, and studies
that run a mechanism from many starting positions.

The technical design is in [DESIGN.md](DESIGN.md); the file format in
[FORMAT.md](FORMAT.md).

## 1. Why a second app

mekasim answers "how does this linkage move?". Models are sketched as links and
pins, or written by hand, and it feels complete for that.

Some mechanisms only work because parts *touch*: a knuckle coupler, a latch, a
ratchet, a pawl, a detent. For those the questions are different:

- Do the parts clear each other over the whole motion, and by how much?
- When one part pushes another, where does it go?
- Does it work not just from one starting position, but from all the positions it
  will meet in use?

These come with a different way of working: outlines are imported from CAD rather
than sketched, and the answer is a pass rate and a map of where it fails rather
than a motion and its plots. Putting both into one interface would crowd an app
that is tight as it is, so mekafit is its own app with its own focused interface,
built from the same parts.

The motivating example is a Janney-style knuckle coupler: two identical heads, each
with a knuckle on a pin. Pushed together, each knuckle is closed by the other and a
lock drops behind it. It must couple when the two heads meet off-centre, at an
angle, with either knuckle open or closed, and it must hold when pulled.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where | A second app, `apps/fit`, in the mekasim repository. mekasim's app, format and output do not change. |
| Sharing | `packages/core` is shared as it is, with a few extension points that mekasim does not use. New code for shapes, contact and studies goes in a new package, `packages/fit`. Shared interface parts move to a new package, `packages/ui`. |
| Guarding mekasim | Every mekasim example solves to the same numbers before and after, and the generated JSON Schema is byte for byte the same. Both are tests. |
| File format | Its own: `.mekafit.yaml`, starting `mekafit: 1`. It is mekasim's format with sections added, so a mekasim model opens in mekafit as it is. A mekafit file does not open in mekasim. |
| Shapes | A body may carry a real outline with holes, made of straight lines and true arcs. Written in the model as path text, a shape is mekasim's own (`shape: { path, holes }`): mekasim draws it and exports it as the part. mekafit adds where outlines come from: DXF or SVG files kept beside the model and named in a `geometry:` section; a body picks its outline by the file's layer, or by a point inside it. |
| Geometry files | Kept as files, not copied into the YAML, so a drawing re-exported from CAD replaces the old one and the study re-runs on it. Saved as a folder (YAML plus files) where the browser allows it, otherwise as a `.zip` of the same. The share link carries the outlines in use as path text, so it stays complete without the files. |
| Clearance | An exact distance between two shapes with its two nearest points, as a measure function, `gap(a, b)`: it plots, reduces with `min` and goes to CSV like any other. |
| Which parts may touch | Listed in a `contacts:` section. The app proposes pairs and writes them in; nothing is guessed silently. |
| Contact | Quasi-static: parts move slowly, so at every step the mechanism is in equilibrium. Solved by mekasim's Newton solver extended with one-sided constraints (gap ≥ 0, joint stops, locks). No game-physics engine, no forward dynamics, no impacts. |
| Springs | Torsion and linear springs, as energy the quasi-static step minimises. No mass needed. |
| Locks | Out-of-plane locks, pawls and detents are `latches` on a joint: a one-way stop that drops in at an angle. Not geometry. |
| Moving a body | A `move` driver carries a body along a line or arc, then can pull it with a force. This is how one coupler is pushed into the other. |
| Studies | A `studies:` section in the model, as `plots:` is in mekasim, so a shared model arrives with its studies. A study varies parameters within ranges, runs the model for each draw and tests it against the model's `checks`, which mekasim has too. |
| Replay | A run is replayed by solving the model with that run's values. Only the values and the outcome are stored. |
| Determinism | Every run is reproducible from the model text and the study seed. No `Math.random` in the solver or studies. |
| Drawing | 2D only, as SVG. The sheet basics (pan, zoom, grid, labels, dimensions) are shared in `packages/ui`, which is also what the embeddable viewer in mekasim's backlog needs. mekasim keeps its Three.js drawing. |
| Where it runs | Studies run in Web Workers in the app and in `worker_threads` from the command line (`pnpm fit:study`). |
| Units | As in mekasim: document units in the file, SI inside (m, rad, s, N). |
| Testing | As in mekasim: Vitest for everything that does not need a browser; the UI is checked by Thomas in the dev server. No Playwright, no headless browser. |
| Hosting | A second static Netlify site from the same repository. |

## 3. How the repository is arranged

```
packages/core   mekasim's core, unchanged except for extension points (DESIGN.md §2)
packages/fit    shapes, distance, contact solver, springs, locks, studies (pure TypeScript, no DOM)
packages/ui     theme and fonts, folds, splitters, choice and field controls, charts,
                the SVG sheet, share links and downloads (React, no app store)
apps/web        mekasim, now importing its theme and controls from packages/ui
apps/fit        mekafit
```

`packages/fit` and `packages/ui` each depend on `packages/core`; `apps/fit` on all
three; `apps/web` on `packages/core` and `packages/ui`. Nothing in `packages/core`,
`packages/ui` or `apps/web` depends on `packages/fit`.

## 4. The pipeline

mekafit runs mekasim's pipeline with additions at each stage:

```
text ──load──▶ document ──compile──▶ SolverModel ──solve──────▶ samples ──measures──▶ values, plots
               mekasim's            mekasim's       plain Newton,          mekasim's measures
               + shapes             + shapes        or the contact step    + gap(), force(),
               + contacts           + one-sided     when the model has       latched(), final()
               + springs, locks       constraints   springs, locks, stops
               + studies            + springs       or a move driver
                                    + move drivers
                                                          studies: the whole pipeline per draw
```

A mekasim model opened in mekafit, with nothing added, solves on mekasim's own path
and gives mekasim's numbers.

## 5. The app

Same look as mekasim: the green-tint paper, graphite ink, dye blue, brass and red
of `theme.ts`, Barlow and IBM Plex Mono, the same folds, splitters and charts. Same
arrangement where it serves: a panel on the left, the sheet in the middle, a panel
below it, a side panel on the right. Different contents:

- **Header**: model name, open, save, share link, "Open in mekasim" when the model
  has no mekafit sections, help.
- **Left panel, two tabs**, with the messages below both as in mekasim:
  - *Source*: the YAML, as in mekasim.
  - *Geometry*: the drawings attached to the model. "Add drawing (DXF, SVG)" attaches
    a file and writes it into `geometry:`. Each file shows its unit, its layers with
    the closed outlines on each, and the import report (open outlines with zoom-to
    buttons, curves replaced by arcs, skipped text and dimensions). Hovering an
    outline lights it on the sheet, and each says which body uses it. While the tab
    is open, unused outlines are drawn faintly on the sheet: click one and choose a
    body for it, or "New body". Round holes offer to become points; two holes on two
    bodies offer a pin. Every click is written into the source. "Replace" swaps in a
    newer export of the same drawing; in Chromium-based browsers "Follow file"
    reloads it whenever it changes on disk. A model opened without its files lists
    them as missing, with "Attach".

  The panel opens on Geometry for a new model, on Source for a model without
  drawings.
- **Tools on the sheet**: Select (V), Pin (P), Contact (K), Measure (D). No link,
  crank or gear tools; those models are built in mekasim and opened here.
- **Side panel folds**, in the order of the work:
  1. *Inspector*: the selected body, joint or contact, as in mekasim.
  2. *Contacts*: the pairs that may touch, "Find contacts" (pairs that come within a
     chosen distance during the motion), and for each pair its smallest gap and
     where. Hovering a row moves the sheet to that instant and draws the gap as a
     dimension. Overlaps in red, worded "runs into".
  3. *Springs and locks*: per joint, with stiffness, rest angle, stops and lock
     angle.
  4. *Studies*: each study with its ranges and number of runs, "Run" and "Stop",
     and progress.
  5. *Parameters*, as in mekasim.
- **Bottom panel**, with two tabs: *Run* (timeline and plots of the current run, as
  in mekasim) and *Study* (results: share passed with its 95% range, a scatter of
  any two varied parameters, failures by condition). Clicking a point of the
  scatter solves that run and shows it on the sheet; "Back to the model" returns.
- **Charts** are plain SVG, as in mekasim. Passes are dye-blue dots, failures red
  crosses, so they differ in shape as well as colour.
- **Wording** as in mekasim: plain sentences, no solver terms. "Runs into" rather
  than "interference", "runs" rather than "samples", "passed" and "failed", "lock"
  rather than "latch" (the format keeps `latches`).

## 6. Phases

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Split | `packages/ui` from mekasim's store-free parts; mekasim imports them; extension points in core; `packages/fit` and `apps/fit` skeletons; the SVG sheet; mekafit opens a mekasim model and plays it; second Netlify site | mekasim looks and works exactly as before (tests, identical schema, and Thomas's check in the dev server); mekafit opens `examples/four-bar.mekasim.yaml` and plays it on the SVG sheet |
| 1 | Shapes | `geometry:` files and `shape` on bodies, exact geometry, DXF and SVG import, the Geometry tab, saving as a folder or `.zip`, shapes drawn on the sheet, `copy` component, DXF export of shapes | Thomas's coupler head and knuckle come in from his DXF, pinned, and a turned copy faces them, all written in clean YAML; replacing the DXF with an edited export changes the shapes and nothing else |
| 2 | Clearance | Exact distance, `gap()` with its nearest points, `contacts:`, Contact tool, "Find contacts", the Contacts fold, message when two parts run into each other | A knuckle turned by a motor shows its smallest gap to its own head over the swing, drawn on the sheet at that instant; a shape made too big is reported as running into its neighbour, with the place |
| 3 | Contact | One-sided constraints, the quasi-static step, springs, stops, locks, the `move` driver, forces from equilibrium, comparisons and new measures, messages for jams, the Springs and locks fold | Pushing one coupler into the other closes both knuckles and both locks drop; with one knuckle held closed the run jams and the message names the touching parts |
| 4 | Studies | `studies:`, ranges, seeded sampling, pass conditions, runner in workers and on the command line, Study tab, click to replay, before and after | A 500-run coupling study over sideways offset, angle and both knuckles' starting angles finishes in under a minute and shows where it fails; clicking a failure shows that run |
| 5 | Friction and tolerance | Coulomb friction at contacts and in pins, shapes grown or shrunk by a tolerance, play in pins, all variable in studies | The coupling study re-run with friction 0.3 and ±0.1 mm on the outlines shows a smaller passing region |

Phase 0 is the only one that touches mekasim, and it changes where code lives, not
what it does. Every later phase is additions in `packages/fit` and `apps/fit`.

Phase 5 comes last on purpose: friction in a quasi-static solver is the hardest
part, and the frictionless result already shows whether the geometry works at all.

## 7. Risks

- **The split disturbs mekasim.** Phase 0 moves code mekasim relies on. Guarded by
  the example and schema tests, by moving only store-free modules first, and by
  Thomas checking mekasim in the dev server before anything else is built.
- **Core grows mekafit-shaped hooks.** Extension points are kept to the four listed
  in DESIGN.md §2, each with a test showing mekasim's behaviour without it.
- **Many touching points.** Two knuckle faces can touch along a whole face. The
  contact step collects several nearest points per pair (DESIGN.md §3.3), and tests
  cover face-on-face cases.
- **Parts that nothing holds.** A knuckle with no spring, untouched, may take any
  angle. The contact step keeps such parts where they were rather than letting them
  wander (DESIGN.md §5.1), as a real knuckle with a little friction in its pin does.
- **Jams versus failures to solve.** The step halves itself several times before a
  jam is reported, and a jam names the contacts that block.
- **Tunnelling.** The `move` driver limits how far any point may travel in one step
  to a fraction of the smallest shape feature, and adds samples as needed.
- **Friction** makes the step a harder problem, with no unique answer in some poses.
  Kept out until phase 5.
- **Outlines changing identity.** A re-exported DXF may list its entities in another
  order. Bodies pick outlines by layer, or by a point inside, never by position in
  the file, so a re-export keeps working unless the outline itself has moved away.
- **Run time.** 500 runs of a few hundred steps must stay near a minute. Budgets
  are tests (DESIGN.md §8).

## 8. Open questions

1. The name.
2. Whether mekasim gets a one-line "Open in mekafit" link in its header. The plan
   leaves mekasim untouched; mekafit links the other way only.
3. Impacts and bouncing (true dynamics) stay out. If ever needed, they are an idea
   for the backlog.
