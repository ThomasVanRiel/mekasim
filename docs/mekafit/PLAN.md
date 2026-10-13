# mekafit — plan

mekafit is a second app in the mekasim repository. It shares mekasim's solver,
expressions and units, its part shapes and its look, and adds what mekasim leaves
out: clearance between the shapes, parts that push each other, and studies that run
a mechanism from many starting positions.

The technical design is in [DESIGN.md](DESIGN.md); the file format in
[FORMAT.md](FORMAT.md). "mekafit" is a working name.

## Where it stands (2026-10-13)

**Phase 0, the split, is built**, except that the second Netlify site still has to
be made in Netlify (package directory `apps/fit`, which has its own `netlify.toml`;
set `VITE_MEKASIM_URL` there for "Open in mekasim").

**Phase 1, shapes, is partly built, and most of it ended up in mekasim.** Thomas
wanted shapes and drawings in mekasim too, so they are part of mekasim's format and
their code is in the shared packages:

- Outlines of lines and true arcs, path text, and the checks on them
  (`packages/core/src/geometry`).
- `shape: { path, holes }` on a body, drawn by both apps and exported as the part.
- DXF reading (lines, arcs, circles, polylines, blocks; splines and ellipses
  replaced by arcs within `fit`, `packages/core/src/geometry/fit.ts`), joining into outlines,
  `geometry:` with `shape: { from, layer, at, place }` (`packages/core/src/drawing`).
- A saved model keeps the outline each body takes from a drawing, as `path` beside
  `from`, so the YAML alone is complete; the drawing wins while it is attached.
- The Geometry tab, with a picture of each layer (`packages/ui/src/drawings`), in
  both apps.
- mekasim also gained `checks:` and conditions in expressions, which studies will
  build on, and "Make" in its header.

What mekafit itself has so far: its first line `mekafit: 1`, the app skeleton (the
shared editor and Geometry tab, the SVG sheet drawing shapes with true arcs, the
Run panel with playback and plots, dividers), and "Open in mekasim". `packages/fit`
has the schema, contact-pair compilation and the calls into core.

**Phase 2, clearance, is built and browser-checked.** In
`packages/core`: the exact distance between two lines or arcs and between two
shapes, with the two places it is between and a negative value where shapes overlap
(`geometry/distance.ts`, `geometry/tree.ts`), and `gap(a, b)` as a function in
measures, checks and plots. Every gap a model asks about is drawn in both apps
between its two nearest places; on mekafit's sheet in red where the parts are into
each other. Two bodies joined by a pin are not counted as running into each other:
their gap is 0 where they overlap, and the model warns about it. In mekafit,
`contacts:` is read, checked and compiled to distinct pairs, and a run reports the
first place a listed pair runs into each other by more than 0.001 mm. Each pair's
closest gap is kept with the run and shown in the Contacts fold; hovering it moves
the run there and draws the gap. The Contact tool writes a picked pair into the
model, and "Find contacts" proposes the shaped pairs that come within a chosen
distance, leaving the choice of which to add to the user. The Contact tool,
finder and example picker have been checked in the browser.
`examples/fit/clearance-check.mekafit.yaml` is mekafit's own
motor-driven example, solved by a test, and the app has its own example picker.

**Not built yet in phase 1:**

- SVG drawings.
- `plate: true` as a shape, and the `copy` component.
- Picking an outline on the sheet to give it to a body, and pins from holes.
- Saving the drawings with the model (folder or `.zip`), and "Follow file".
- True arcs when shapes are exported (`shapesToDxf` exists and is used for the
  example drawing; "Make" still writes polygons).
- A shape on `ground` is drawn in mekafit but not in mekasim's 3D view.

**Browser checks passed by Thomas:** the `gap()` and unchanged `dist` drawing from
commit `a5debb5`; the Contacts fold's rows, closest values, hover-to-step behavior
and gap dimension; the Contact tool; "Find contacts"; and mekafit's own example
picker with the clearance example. In the shaped four-bar the two pinned pairs
correctly stay at 0, while crank and rocker come closest at 97 mm at step 217.

**Waiting for Thomas:** nothing in phase 2.

**Phase 3, contact, has started.** Its force, torque and spring-stiffness units are
built through mekafit's expression registry, without adding them to mekasim. The
small dense quadratic program is built and checked against hand-solved, redundant
and infeasible cases. `contactPoints` finds up to four distinct nearby places with
their normals, including both ends of flat faces. Contact points now become
one-sided rows with their translation and rotation gradients, ready for the
quadratic program. `springs:` is read and checked (`packages/fit/src/compile.ts`):
both kinds, their stiffness and preload with units, and each preload turned into a
rest value where the joints close from the starting pose. `solver/springs.ts` gives
their energy, gradient and Hessian.

The contact step runs models (`solver/quasistatic.ts`, with the stage paths and the
pose constraint in `solver/stages.ts`): at each sample the spring energy is
minimised under the joints, the drivers and the contact rows, with samples split
where a body moves far or the step does not settle, and a jam that names the parts
in each other's way ("Jams at 0.876 s: `pusher` against `block`, ..."). A model with
springs or a `move` driver is solved by it; any other still goes down mekasim's
cycle solve. The `move` driver is in the format, with `to` and `via` stages and
with `pull` and `push`, which let the body go and pull it: it rests where a spring
or a contact holds it, and a pull that nothing holds comes free, which is told as
a remark and kept with the run. It
needed nothing in core: mekafit's schema gives the `drivers` section again with the
move in it, and core's `prepare` hook sets the moves aside before core compiles the
rest. `contactPoints` was changed for the step: where shapes are into each other
the distance is negative and the normal keeps its direction, and two flat faces
along each other give their two ends. `examples/fit/sprung-lever.mekafit.yaml` is
the first example solved by contact.

Joint `stops` and `latches:` are built: a stop holds a revolute joint's angle or a
slider's or pin-slot's travel between its two ends, and a lock drops in once its
joint has passed its place and then holds it there. Both are one-sided rows of the
contact step, and a model with either is solved by it. Whether each lock is in at
each sample is kept with the run (`latched`), for the `latched()` measure to come.
A jam names them too: "`ram` against its stop".

Forces are found at every solved sample from the balance of the parts
(`Loads` in `solver/quasistatic.ts`): what presses each contact together, what each
spring carries, how hard each stop and lock is held, and what each driver puts on
its body. The measures `force`, `torque`, `latched`, `final` and `first` read them
(`packages/fit/src/measures.ts`, through core's registry), and mekafit's plots show
forces in N and torques in N·mm (N·m in a model not drawn in millimetres).

The Springs and locks fold is built (`apps/fit/src/panels/SpringsLocks.tsx`, its
wording in `apps/fit/src/springs.ts`): each spring, each joint with stops and each
lock, with what it is and how it stands at the step being shown ("Pulling with
40 N", "Against its stop with 60 N", "In, holding 20 N"). A lock is drawn on the
sheet as a small brass square on its joint, filled when it is in. Not yet checked
in the browser.

`examples/fit/door-latch.mekafit.yaml` is built: a sprung bolt with a slanted nose
that a strike pushes back and that then holds the door against a pull. Building it
found two faults, both fixed: the quadratic program gave up when two rows it held
said the same thing in part (it now lets go of the one that carries nothing), and
two corners near each other were taken for parts into each other (overlap is now
told by a place lying in the other shape's material).

`examples/fit/ratchet.mekafit.yaml` is built too: a toothed wheel turned 100
degrees against a spring, a sprung pawl that rides up each tooth and drops behind
it, and the wheel let go, which the pawl then holds. It needed the contact finder
on a firmer footing (DESIGN.md §3.3): every corner of one shape against the nearest
place of the other, which is the face's own corner once the corner has passed the
face's end, in place of every pair of segments with rules for the special cases.
And where the rows as laid out do not let the whole of a closing step through, the
step now takes part of it and lays the rows out again.

`examples/fit/knuckle-coupler.mekafit.yaml` is built: two much simplified couplers,
one standing with its knuckle open, the other pushed into it with its knuckle shut
and locked. The nose strikes the open knuckle's tail and swings it shut, its lock
drops, and a pull of 150 N is then held by the hooked noses and both locks. With
both knuckles shut the run jams and names them, as phase 3 asks. It differs from
the "done when" of phase 3 in one thing: only one knuckle starts open. In this
simple shape two open knuckles pass each other's tails; closing both at once needs
the thrower a real coupler has inside its head.

`examples/fit/push-latch.mekafit.yaml` is built, Thomas's push-to-open catch: a pin
that can only go sideways, in a track round a heart on the drawer. One push and
the pin is caught in the heart's cleft with the drawer in; the next and it goes
down the other side and the drawer comes out. It goes round one way because each
peak of the track stands to one side of the pocket before it; there is no spring
on the pin. The shapes are drawn to work, not to look like a bought catch.

A part that a spring carries a long way, as the drawer coming out, now takes
several samples over it instead of failing to settle in one.

**Phase 3 is built.** Its examples are in mekafit's picker; none of it has been
seen in the browser yet. Phase 4, studies, is next (DESIGN.md §6 and §9), unless
Thomas would first have what phase 1 still lacks.

**Open, for Thomas to say when he looks:** `force()` and `torque()` cover contacts,
springs and drivers, as FORMAT.md lists them. How hard a stop or a lock is held, and
the force in a pin, are found and kept with the run but have no measure yet, since
a joint's name could mean its pin's force or its stop's.

**Waiting for Thomas (2026-10-13):** a look at the sprung lever in mekafit's dev
server (the lever should lie against the bar's corner all the way down and back,
and its angle plot should be a smooth dip to 0; its force plots in N and N·mm; the
Springs and locks fold beside it); and the two mekasim fixes of the
same day, the middle click that pasted and the ground plate's doubled holes.

**Phase 2 was built in this order** (mekafit's parts are in `packages/fit` and
`apps/fit`; DESIGN.md §4 and FORMAT.md "Contacts" say what each is):

1. **Built.** `contacts:` in mekafit's schema (`between: [a, b]`, `among: [...]`), added through
   `documentSchema`'s `sections` in `packages/fit/src/schema.ts`, and compiled to
   pairs of bodies in the `extend` hook of `simulate` (`packages/fit/src/simulate.ts`):
   `among` expanded, pairs given twice dropped, a name that is no body or has no
   `shape` reported as an error at its place.
2. **Built.** After the run, each pair's gap over the motion with core's `gapsOf`
   (`packages/core/src/analysis/gaps.ts`), which already leaves pinned pairs at 0.
   The first sample where a pair is more than 0.001 mm into each other gives the
   message "`knuckle` runs into `head` at step 41, 0.3 mm deep", at the contacts
   entry. A pinned pair that lies over each other gets the same warning `gap()`
   gives, not this message.
3. **Built and browser-checked.** The result per pair (smallest gap, its step,
   its two places) kept beside the simulation for the Contacts fold, then the fold
   itself in `apps/fit/src/panels`, with hovering a row moving the run to that step.
4. **Built and browser-checked.** The Contact tool and "Find contacts" (§3
   below, DESIGN.md §4).
5. **Built and browser-checked.** `examples/fit/clearance-check.mekafit.yaml`,
   motor-driven, gaps only, solved by a test as DESIGN.md §8 says, and mekafit's
   own example picker (Thomas asked that its examples be separate from mekasim's).

Then phase 3, the contact step (DESIGN.md §5), which starts with
`contactPoints` (§3.3) on top of `geometry/distance.ts`. Its force units were built
first, following DESIGN.md §9; the quadratic program, `contactPoints`, the contact
rows, the springs and the step for `to` stages are built too.

**Settled with Thomas on 2026-10-13**, beyond what the sections below say:

- `gap()` and the distance code are mekasim's (`packages/core`), not mekafit's.
- Two bodies joined by a revolute joint are never counted as overlapping. Their gap
  is 0 where they lie over each other, with a warning; the design is drawn so that
  such parts clear each other round the pin. No radius round the pin, no use of
  `layer` for this.
- A drawing whose file does not say its unit gets it picked in the Geometry tab,
  which writes `unit:` under `geometry:`.
- `fit` (how closely splines and ellipses are replaced by arcs) is mekasim's.
- A positive straight-spring `preload` is tension, pulling its two points together.
  A positive torsion-spring `preload` turns its joint in the positive-angle
  direction. Negative values act the other way.
- A stiffness or a preload is written with its unit (`2 N/mm`, `5 N`). A plain
  number is not read, since the document has no unit of its own for forces; a plain
  `0` preload is read as none. (Claude's choice while building springs; say if a
  default unit is wanted instead.)
- A push-to-open latch, a pin riding in a heart-shaped slot as in a drawer catch, is
  wanted as a mekafit example once contact is solved (DESIGN.md §8).

**Thomas's own coupler drawing** is `ref/coupler.dxf`. `ref/` is ignored by git, so
it may not be there, and nothing of it is committed or used in tests. It reads as
one outline with two holes on layer `VISIBLE`, in millimetres once that is picked,
with no splines and nothing left out; a gap between two copies of it takes about
20 µs, against a budget of 50 µs for 200-segment shapes that has not been measured
yet.

**Changed from the plan below:** the plan was written when mekasim was to stay
untouched. Where it says that shapes, path text, geometry files or conditions are
mekafit's, they are mekasim's now. Studies test the model's `checks` (mekasim's)
unless a study has a `pass` of its own. `docs/mekafit/FORMAT.md` says at its top
which of its sections describe things that moved to mekasim.

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
| Shapes | A body may carry a real outline with holes, made of straight lines and true arcs. Shapes are mekasim's own: written in the model as path text (`shape: { path, holes }`), or taken from a DXF file kept beside the model and named in a `geometry:` section, where a body picks its outline by the file's layer or by a point inside it. mekasim draws a shape and exports it as the part; mekafit measures gaps and contact on it. |
| Geometry files | Kept as files, not copied into the YAML, so a drawing re-exported from CAD replaces the old one and the study re-runs on it. The model keeps the outline each body takes from a drawing, as `path` beside `from` (mekasim's format does this), so the YAML alone, saved or in a link, is complete without the files. Saving the files with it, as a folder or `.zip`, is still to come. |
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
apps/sim        mekasim, now importing its theme and controls from packages/ui
apps/fit        mekafit
```

`packages/fit` and `packages/ui` each depend on `packages/core`; `apps/fit` on all
three; `apps/sim` on `packages/core` and `packages/ui`. Nothing in `packages/core`,
`packages/ui` or `apps/sim` depends on `packages/fit`.

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
