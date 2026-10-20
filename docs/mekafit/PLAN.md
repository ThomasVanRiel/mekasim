# mekafit — plan

mekafit is a second app in the mekasim repository. It shares mekasim's solver,
expressions and units, its part shapes and its look, and adds what mekasim leaves
out: clearance between the shapes, parts that push each other, and studies that run
a mechanism from many starting positions.

The technical design is in [DESIGN.md](DESIGN.md); the file format in
[FORMAT.md](FORMAT.md). "mekafit" is a working name.

## Where it stands (2026-10-15)

**Phase 0, the split, is built.** mekafit's own Netlify site is up at
<https://mekafit.netlify.app/>, built from `apps/fit` with its own `netlify.toml`.
`VITE_MEKASIM_URL` still has to be set there for "Open in mekasim".

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

What mekafit itself has: its first line `mekafit: 1`, its own sections of the
format (`contacts:`, `springs:`, `latches:`, `stops` on a joint, the `move` driver),
the contact step that solves them, and the app: the shared editor and Geometry tab,
the SVG sheet drawing shapes with true arcs, the Select and Contact tools, the Run
panel with playback and plots, the Parameters fold with a slider for each plain
value (the slider itself is mekasim's, in `packages/ui`), the Contacts and the
Springs and locks folds,
dividers, its own example picker, and "Open in mekasim".

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

**Phase 2's browser checks, passed by Thomas:** the `gap()` and unchanged `dist` drawing from
commit `a5debb5`; the Contacts fold's rows, closest values, hover-to-step behavior
and gap dimension; the Contact tool; "Find contacts"; and mekafit's own example
picker with the clearance example. In the shaped four-bar the two pinned pairs
correctly stay at 0, while crank and rocker come closest at 97 mm at step 217.

**Phase 3, contact, is built and browser-checked.** A model with springs, stops,
locks or a `move` driver is solved by the contact step; any other still goes down
mekasim's cycle solve, with contacts only checked. In `packages/fit/src`:

- **Units and format.** Force, torque and stiffness units through mekafit's
  expression registry, without adding them to mekasim (`registry.ts`). `springs:`,
  `latches:`, joint `stops` and the `move` driver with `to`, `via`, `pull` and
  `push` stages are read and checked (`schema.ts`, `compile.ts`), each problem told
  at its place. The `move` driver needed nothing in core: mekafit's schema gives the
  `drivers` section again with the move in it, and core's `prepare` hook sets the
  moves aside before core compiles the rest.
- **The contact step** (`solver/quasistatic.ts`, DESIGN.md §5): at each sample the
  spring energy is minimised under the joints, the drivers and the one-sided rows
  of contacts, stops and locks (`solver/inequality.ts`), with a small quadratic
  program (`solver/qp.ts`), the springs' energy from `solver/springs.ts` and the
  stages of a move from `solver/stages.ts`. Samples are split where a body moves
  far or the step does not settle.
- **Contact points** (`geometry/contacts.ts`, DESIGN.md §3.3): up to six places per
  pair, each corner against the nearest place of the other shape, facing flat faces
  at both ends of the stretch they share, and curves where they are nearest. Where
  shapes are into each other the distance is negative and the direction holds.
- **What a run tells.** A jam names the parts in each other's way ("Jams at
  0.876 s: `pusher` against `block`, `ram` against its stop"). A pull that nothing
  holds "came free", which is a remark and is kept with the run (`free`). Whether
  each lock is in at each sample is kept too (`latched`).
- **Forces** at every solved sample, from the balance of the parts (`Loads`): what
  presses each contact together, what each spring carries, how hard each stop and
  lock is held, and what each driver puts on its body.
- **Measures** `force`, `torque`, `latched`, `final` and `first` (`measures.ts`).
  mekafit's plots show forces in N and torques in N·mm (N·m in a model not drawn in
  millimetres).
- **A body that a driver has let go moves at a pace**, however it is taken along:
  at most the model's size over its stage. So a drawer that a spring brings back is
  seen to come back. Thomas found the return in one sample odd (2026-10-13).

In `apps/fit/src`: the Springs and locks fold (`panels/SpringsLocks.tsx`, its
wording in `springs.ts`) lists each spring, each joint with stops and each lock,
with what it is and how it stands at the step being shown ("Pulling with 40 N",
"Against its stop with 60 N", "In, holding 20 N"). A lock is drawn on the sheet as
a small brass square on its joint, filled when it is in.

The examples in `examples/fit/`, each solved by a test and in the app's picker:

| Example | What it shows |
|---|---|
| `clearance-check` | Phase 2: a knuckle turned by a motor, gaps only |
| `sprung-lever` | A lever held up against a bar by a spring gives way under it and follows it back |
| `door-latch` | A sprung bolt with a slanted nose is pushed back by the strike, then holds the door against a pull of 20 N |
| `ratchet` | A wheel turned against a spring; a sprung pawl rides up each tooth and drops behind it, and holds the wheel when it is let go |
| `knuckle-coupler` | Two much simplified couplers: the nose of one swings the other's open knuckle shut, its lock drops, and a pull of 150 N is held |
| `push-latch` | Thomas's push-to-open catch: a pin in a track round a heart; one push and the drawer stays in, the next and it comes out |
| `coupler-trial` | Thomas's coupler, from his drawings `knuckle.dxf` and `anvil.dxf`: two knuckles swung shut and locked as one is driven into the other; its study `coupling` varies the sideways offset and how far each starts open |

Where phase 3 as built differs from what was planned:

- **The coupler** starts with one knuckle open, not both. In this simple shape two
  open knuckles pass each other's tails; closing both at once needs the thrower a
  real coupler has inside its head. With both knuckles shut the run jams and names
  them, as the phase asks.
- **The push latch** has no spring on its pin. The pin goes round one way because
  each peak of the track stands to one side of the pocket before it. The shapes are
  drawn to work, not to look like a bought catch.
- **No measure for a stop, a lock or a pin.** How hard a stop or a lock is held is
  found and kept with the run and shown in the fold, but `force()` and `torque()`
  cover contacts, springs and drivers only, since a joint's name could mean its
  pin's force or its stop's. The force in a pin is not kept.
- **Jerk on a contact run** is still worked out from the joints as in mekasim,
  which does not hold where parts push each other; speed and acceleration are from
  the sampled positions (DESIGN.md §5.9).
- **Speed budgets** (DESIGN.md §8) are not tests yet. The examples run in 50 to
  250 ms each.

**Browser checks passed by Thomas (2026-10-13):** every example in mekafit's
picker with its motion and plots, the Springs and locks fold, the lock markers, and
that the page no longer scrolls behind its panels; in mekasim, that a middle click
on the view no longer pastes, and the strandbeest's ground plate in the STL.

**Also passed (2026-10-15):** the pace of a let-go body: the push latch's drawer
and the ratchet's wheel come back over a number of steps.

**Phase 4, studies, is built; its browser check is to come.** In `packages/fit/src/study`:
`studies:` read and checked against the parameters, each problem at its place
(`plan.ts`); seeded draws by `random`, `spread` and `grid` (`random.ts`,
`sample.ts`); one run written into the text, solved and judged by the checks or the
study's `pass` (`run.ts`); the pass rate with its Wilson range, the rate over each
range and the two parameters that matter most (`stats.ts`); and `pnpm fit:study`,
which runs them in worker threads and prints the summary (`cli.ts`, `node.ts`).
In the app: module workers, one fewer than the machine's threads, fed batches of
eight; a Studies fold with Run and Stop; a Study tab beside Run with the pass rate,
the scatter, what was not met (click to filter), the runs not solved and the rate
over each range, whose strips filter the runs to a part of a range (each strip
counted over the runs the other filters keep); with more than one condition, each
condition's own share, and "Counted as passed" to judge the runs by some of them
only, which the pass rate, scatter, shading and strips follow; clicking a run shows it on the
sheet and in the Run tab, with
"Back to the model" and "Use these values"; results kept in IndexedDB per model,
drawings and study, and the last results kept as "before" when the model changes.

The knuckle coupler has a study, `coupling`, over the left knuckle's starting angle
(0 to 45 deg) and the right coupler's sideways offset (-8 to 8 mm). Its 500 runs
take 22 s with `pnpm fit:study` on 15 threads here; 41% pass. It fails where the
knuckle starts nearly shut, and towards a large offset either way.

Thomas's own coupler (`coupler-trial`, from his drawings) has the study the phase
asks for, but for the angle: the sideways offset `dy` (-8 to 8 mm) and how far each
coupler starts open (0 to 85 deg). A run takes about 1.2 s alone; 500 took 4 min
here on 15 threads. 12% pass (9% to 15%), none fail to solve. It passes every time
with `dy` from 0 to 5 mm and both more than 60 deg open; coming in below the middle
line (`dy` below 0) the couplers come home about 6 deg short of shut and do not
lock, 2 of 250 pass; starting less than about 25 deg open, or beyond the bases'
5 mm of play, it jams. Whether the 6 deg is the design or the guessed side spring,
play and peg is for Thomas to judge.

Where phase 4 as built differs from what was planned:

- **The coupling study** on Thomas's coupler varies three values, not four: the
  coupler's angle is not a parameter of the trial yet. The simplified knuckle
  coupler's study varies two.
- **Its 500 runs take longer than a minute**: 4 min here; on Thomas's machine,
  with threads that are not shared, perhaps one to two.
- **A jam is a result**, judged by the conditions, not a run that could not be
  solved: in the coupler a jam is what failing looks like.
- **Threads here scale poorly**: eight processes each run 3 times slower than one
  alone in this sandbox, so a study on Thomas's own machine may well be quicker.

**Waiting for Thomas: a look at studies in mekafit's dev server** (open the
"Knuckle coupler" example, whose 100 runs are quick, then "Coupler trial"):

1. The Studies fold at the bottom of the side panel: "Coupling", its two ranges,
   and Run. Run switches the panel under the sheet to its Study tab; the runs
   come in a few times a second, and Stop keeps what has run.
2. The Study tab: the pass rate and its range, the scatter (blue dots passed, red
   crosses failed), Across and Up, "Not met" (clicking a condition leaves the
   other runs faint) and the bars of the rate over each range.
   Dragging across a parameter's strip keeps only the runs in that part of its
   range: the scatter leaves the others faint, the pass rate, "Not met" and the
   other strips count the runs kept, "All runs" gives the rate of them all, and
   "Show all runs" lets them back. Pressing the one bar kept again does too; Shift
   with a press extends a range. On the coupler trial: `dy` from 0 to 5 mm, with
   `open_a` across and `open_b` up, should show the passing corner above 60 deg.
3. Clicking a run in the scatter: it plays on the sheet with a box at the top left
   saying which run and how it went; "Back to the model" returns, and "Use these
   values" writes them into `params`. The run is ringed in the scatter.
4. After a change to the model, the tab says its results are from an earlier
   version; run again, and the old failures show as faint dashed crosses with
   "Before:" and their rate. Reloading the page shows the last results again.
5. On the coupler trial, under the pass rate: "Each alone" with the share of runs
   that came home and the share that locked, and "Counted as passed" with Home and
   Locked ticked. Untick Locked: the pass rate reads "Met Home in …", and the
   scatter, the shading and the strips judge the runs by homing alone.
6. Typing in the coupler trial's source does not stall: the text keeps up, the
   sheet keeps showing the last solved motion, "Working out the motion…" shows at
   its bottom left while it is worked out, and the new one replaces it a few
   seconds after typing stops. A quick model such as the sprung lever updates as
   before, without the note.
7. In mekasim, nothing should have changed.

**Open, for Thomas to say:**

1. What comes after phase 4: phase 5 (friction and tolerance) is to be planned once
   studies are in use; or first what phase 1 still lacks (the list above).
2. Whether stops, locks and pins get measures of their force, and under what names.

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

Phase 3 followed in the order of DESIGN.md §9: force units, the quadratic program,
contact points and their rows, springs, the step for `to` stages and then `pull`,
stops and locks, forces, the measures, the fold, the examples.

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
  wanted as a mekafit example once contact is solved. It is built
  (`examples/fit/push-latch.mekafit.yaml`).
- A body that a spring brings back must be seen to come back, not be found there
  in the next step.

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
| Contact | Quasi-static: parts move slowly, so at every step the mechanism is in equilibrium. Solved as mekasim solves its joints, with one-sided constraints added (gap ≥ 0, joint stops, locks) and a small quadratic program for each step. No game-physics engine, no forward dynamics, no impacts. |
| Springs | Torsion and linear springs, as energy the quasi-static step minimises. No mass needed. |
| Locks | Out-of-plane locks, pawls and detents are `latches` on a joint: a one-way stop that drops in at an angle. Not geometry. |
| Moving a body | A `move` driver carries a body along a line or arc, and can let it go and pull it with a force. This is how one coupler is pushed into the other. |
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
- **Tunnelling.** No body that can touch another may go further in one step than a
  quarter of its shape's thickness; samples are added as needed.
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
