# The mekafit model format

A mekafit model is one YAML file, by convention named `something.mekafit.yaml`,
starting with `mekafit: 1`. It is the mekasim format, described in
[../mekasim/FORMAT.md](../mekasim/FORMAT.md), with the sections and fields on this page added.
Everything there holds here: units and expressions, bodies, joints, components,
drivers, pose, traces, measures, plots, frames.

- A mekasim model (`mekasim: 1`) opens in mekafit as it is, and solves to the same
  numbers.
- A mekafit model does not open in mekasim. mekasim's format does not change.
- Every addition is optional. A mekafit model without any of them is a mekasim model
  with another first line.

This page was written ahead of the build. The phase that adds each part is given in
its heading (see [PLAN.md](PLAN.md)), with "built" where it is.

**Built:** the first line `mekafit: 1`; `contacts:`; `stops` on a joint;
`springs:` with the units of force, torque and stiffness; `latches:`; the `move`
driver with all its stages; the measures `force`, `torque`, `latched`, `final`
and `first`; and `studies:`. A model with springs, stops, locks or a `move` driver is solved by the
contact step, in which listed contacts push and springs settle; any other is solved
as mekasim solves it, with its contacts only checked. The models in
[`examples/fit/`](../../examples/fit) use all of it and run as they are.

**Not built:** of the shapes below, SVG drawings, `plate` and the `copy` component. `friction` is phase 5.

**mekasim's own by now**, and described in [../mekasim/FORMAT.md](../mekasim/FORMAT.md):
shapes written out as `path` or taken from a DXF drawing with `geometry:`, `from`,
`layer`, `at`, `place` and `fit` ("Shapes" and "Shapes from a drawing" there),
`checks:` and conditions, and `gap(a, b)`. The sections on shapes below are kept
for what mekasim does not have yet.

## A whole example

A knuckle coupler, modelled once and placed a second time turned round. The
outlines come from `coupler.dxf`, kept beside the model, where the head and the
knuckle were drawn on layers of their own.

This is what the format is meant to carry in the end. It does not run yet: `copy`
and `studies:` are not built. `examples/fit/knuckle-coupler.mekafit.yaml` is a
coupler that does.

```yaml
mekafit: 1
meta:
  name: Knuckle coupler
  units: { length: mm, angle: deg }

params:
  dx: { value: 0 mm, min: -8, max: 8 }          # sideways offset of the coming coupler
  turn: { value: 0 deg, min: -4, max: 4 }       # its angle against the line of approach
  a_open: { value: 70 deg, min: 0, max: 70 }    # how far each knuckle starts open
  b_open: { value: 0 deg, min: 0, max: 70 }

geometry:
  coupler: { file: coupler.dxf }                # in the same folder as this model

bodies:
  head:
    points: { O: [0, 0], K: [52, -18], C: [-120, 0] }
    shape: { from: coupler, layer: HEAD }       # the outline on layer HEAD, with its holes
    layer: 0
  knuckle:
    points: { K: [52, -18], T: [20, 10] }
    shape: { from: coupler, layer: KNUCKLE }
    layer: 0

components:
  b:
    type: copy
    of: [head, knuckle]                         # their joints, springs and locks come along
    turn: 180 deg

joints:
  fix:   { type: weld, connect: [ground.O, head.O] }
  pin:   { type: revolute, connect: [head.K, knuckle.K], stops: [0 deg, 70 deg] }

springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }

latches:
  lock: { joint: pin, at: 2 deg, drops: down }

contacts:
  coupling: { among: [head, knuckle, b_head, b_knuckle] }

drivers:
  push:
    move: b_head
    stages:
      - { to: [0, 0, 180 deg], time: 2 s }      # carried into the coupled position
      - { pull: [-500 N, 0], time: 0.5 s }      # then pulled away with a force

pose:
  knuckle: [0, 0, a_open]
  b_head: [400, dx, 180 deg + turn]
  b_knuckle: [400, dx, 180 deg + turn + b_open]

measures:
  tightest: min(gap(knuckle, b_knuckle))
  push_force: max(force(push))

checks:                                         # what a run has to meet
  couples: final(latched(lock)) and final(latched(b_lock))
  holds: final(dist(head.O, b_head.O)) < 125 mm
  not_too_hard: push_force < 80 N

plots:
  clearance: [gap(knuckle, b_knuckle), gap(knuckle, head)]

studies:
  coupling:
    runs: 500
    seed: 1
    vary: [dx, turn, a_open, b_open]            # each over its min to max
```

## Shapes (phase 1; what is built is mekasim's, the rest is to come)

```yaml
geometry:
  coupler: { file: coupler.dxf }
  pawl: { file: parts/pawl.svg, unit: mm }

bodies:
  head:
    points: { O: [0, 0], K: [52, -18] }
    shape: { from: coupler, layer: HEAD }
  knuckle:
    points: { K: [52, -18] }
    shape: { from: coupler, at: [70, -25] }
  pawl:
    points: { P: [0, 0], T: [30, 0] }
    shape: { from: pawl, layer: outline, place: [210, 40, 15 deg] }
  washer:
    points: { O: [0, 0] }
    shape:
      path: "M -8 0 A 8 8 0 1 1 8 0 A 8 8 0 1 1 -8 0 Z"
      holes: { O: 4 mm }
```

`shape` gives the real outline of a body. It is used for drawing, for gaps and
contact, and for export; it does not change the motion of a mechanism without
contacts.

### Geometry files

`geometry:` names the drawings the model uses. They are kept as files beside the
model, not copied into it, so a drawing exported again from CAD takes the place of
the old one.

| Field | Meaning |
|---|---|
| `file` | Path of a DXF or SVG file, relative to the model's folder |
| `unit` | Length unit of the drawing, when the file does not say: `mm cm m in` |
| `fit` | How closely curves that are not arcs, such as splines, are replaced by arcs; default 0.002 mm |

A file that is missing is reported, and the model still solves, without the shapes
that come from it.

### Shape from a drawing

| Field | Meaning |
|---|---|
| `from` | A name from `geometry:` |
| `layer` | The DXF layer (or the `id` of an SVG group) the outline is on. With one closed outline on the layer, that is the shape, with the outlines inside it cut out |
| `at` | `[x, y]`, a point inside the wanted outline, in the drawing's coordinates. Needed when the layer has more than one outline, or when no layer is given |
| `place` | `[x, y, angle]`: where the body's own frame sits in the drawing. Default `[0, 0, 0]`, which is right for a body written as drawn |
| `holes` | Round holes added at named points, as below |

A body written as drawn has its frame on the sheet's origin, so the drawing's
coordinates are the body's own and no `place` is needed. A body described by its
dimensions gives `place`, so the outline lands where its points are.

### Shape written out

`shape: { path, holes }` is mekasim's, described in [../mekasim/FORMAT.md](../mekasim/FORMAT.md)
under "Shapes", with the path text it reads. mekafit adds one more way to write it:

| Field | Meaning |
|---|---|
| `plate` | `true` instead of `path`: the plate mekasim draws and fabricates round the body's points, as a shape that gaps and contact can use |

A share link carries every shape that comes from a drawing written out as `path`,
so that the link is complete without the files. A model whose shapes are all
written out, and that has nothing else of mekafit's, opens in mekasim.

Curves in a drawing that are not arcs, such as splines and ellipses, are replaced
by arcs within `fit`, and the Geometry tab lists where it did so.

### copy

```yaml
components:
  b:
    type: copy
    of: [head, knuckle]
    turn: 180 deg
    about: [0, 0]
    mirror: false
```

Places bodies a second time. The copies are named with the component's name in
front, `b_head` and `b_knuckle`, and so are the joints, springs and locks that join
only bodies in `of` (`b_pin`, `b_lock`). A joint between a copied body and one that
is not copied is not copied.

| Field | Meaning |
|---|---|
| `of` | The bodies to copy |
| `turn` | Angle the copies are turned by, about `about`; default 0 |
| `about` | Point turned about, `[x, y]`; default `[0, 0]` |
| `at` | Shift after turning, `[x, y]`; default `[0, 0]` |
| `mirror` | `true` mirrors across the y axis before turning; default `false` |

## Contacts (phases 2 and 3, built)

```yaml
contacts:
  faces: { between: [knuckle, b_knuckle] }
  coupling: { among: [head, knuckle, b_head, b_knuckle] }
```

The pairs of bodies that may touch. Only bodies with a `shape` can be named.
`between` names one pair, `among` every pair in a list. Bodies joined by a pin can
be named, such as a knuckle and its head, but where such a pair lies over each
other is not counted as running into each other, as with `gap`: their outlines have
to be drawn clear of each other round the pin, and a warning says so when they are
not.

In a model that the contact step solves (one with springs, stops, locks or a `move`
driver), the listed pairs push each other: neither goes into the other, and a part
that nothing else holds is moved by the part that meets it. Pairs that are not
listed pass through each other. A run that cannot go on because parts are in each
other's way stops there and names them: "Jams at 0.876 s: `pusher` against `block`".

Without contact solving, contacts are only checked: a pair that runs into each
other by more than 0.001 mm is reported with the step and how deep.
The Contact tool writes a picked pair as `between`. "Find contacts" lists shaped
pairs that come within a chosen distance during the run and writes only the pairs
the user checks; pairs already in `contacts:` are shown checked.

| Field | Meaning |
|---|---|
| `between` / `among` | The bodies, as above |
| `friction` | Phase 5. Coefficient of friction; default 0 |

## Joint stops (phase 3, built)

```yaml
joints:
  pin: { type: revolute, connect: [head.K, knuckle.K], stops: [0 deg, 70 deg] }
  guide: { type: pin-slot, axis: [ground.A, ground.B], point: ram.P, stops: [0 mm, 120 mm] }
```

`stops` limits a revolute joint's relative angle, or the travel along a pin-slot or
slider measured from the first axis point. Either end may be `null`. The angle is
that of the second body the joint connects less that of the first, as for a driver
and a spring. A plain number is in the document's unit. A joint that starts beyond
a stop is brought back to it at the start.

## Springs (phase 3, built)

```yaml
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
  return: { connect: [ram.P, ground.Q], stiffness: 2 N/mm, length: 40 mm }
```

A torsion spring on a revolute joint, or a straight spring between two points.
`rest` is the joint angle and `length` the length at which it pushes nothing.
`preload` instead of `rest` or `length` gives the torque or force at the starting
position. A positive preload on a straight spring is tension: it pulls its two
points together. A positive preload on a torsion spring turns the joint in its
positive-angle direction. A negative preload acts the other way. The starting
position is where the joints close from the `pose`. New units: `N`,
`N*m`, `N*mm`, `N/mm`, `N*m/rad`, `N*mm/deg`.

A spring has either its rest value or a `preload`, not both. `stiffness` and
`preload` are written with their unit; a plain number is not read, except a
`preload` of `0`. A joint's angle is that of the second body it connects less that
of the first, as for a driver.

## Locks (phase 3, built)

```yaml
latches:
  lock: { joint: pin, at: 2 deg, drops: down, engaged: false }
```

A lock that drops in behind a joint, as the lock block of a coupler drops behind
the knuckle's tail. When the joint's angle (or travel) passes `at` going the way
`drops` says, the lock is in, and from then on the joint cannot go back past `at`.
Nothing lets a lock out again. The app draws a lock as a small square on its joint,
filled while it is in.

| Field | Meaning |
|---|---|
| `joint` | A revolute joint, pin-slot or slider |
| `at` | Where it drops in |
| `drops` | `down`: it drops in as the value falls below `at`, and then holds it below. `up`: the other way round |
| `engaged` | Whether it is in at the start. Left out, it is in where the joint starts beyond `at` the way it drops, as a sprung pin would be, and out otherwise. `false` keeps it out until the joint next passes `at` |
| `catch` | How far short of `at` it starts pulling the joint in, as a sprung pin with a pointed tip draws the hole under it once it finds the hole's edge. Given with `pull` |
| `pull` | How hard it pulls the joint in meanwhile: a torque, such as `0.4 N*m`, for a turning joint, a force for one that slides |

A lock with a `catch` pulls its joint the last of the way in, evenly, from `catch`
short of `at` until it is in; then it holds as any lock does. A pin 47.5 mm from a
coupler's pivot with a 4.5 mm hole to find, pressing its edge sideways with 10 N,
is `catch: 5.4 deg, pull: 10 N * 47.5 mm`.

## Moving a body (phase 3, built)

```yaml
drivers:
  push:
    move: b_head
    stages:
      - { to: [0, 0, 180 deg], time: 2 s }
      - { pull: [-500 N, 0], time: 0.5 s }
```

Carries a body through stages, one after the other, starting from its `pose`.

| Stage | Meaning |
|---|---|
| `to: [x, y, angle]`, `time` | The body's frame moves in a straight line and turns evenly to this pose |
| `via: [x, y]` with `to` | Along an arc through this point instead of a straight line |
| `pull: [fx, fy]`, `time` | The body is let go and pulled with this force; where it ends depends on what holds it |
| `push` | As `pull`; the same thing, for readability |

A model with a `move` driver is solved over its stages instead of over a cycle:
`cycle.steps` gives the number of steps over all stages together, the start and
the end both sampled, and more are added where parts move fast against each other.
Plots are drawn against time. `to` is a place on the sheet, not a distance from the
start; a `time` is in seconds unless it has a unit. A body has one `move` at most.

A pull acts at the origin of the body's frame, and its force is written with its
unit. The body goes where the pull takes it until a spring or a contact holds it.
If nothing does, it moves on at an even pace for the stage's time, and the run
says that the driver came free; that is a result to check for, not a fault in the
model. A body that is let go never goes faster than that pace, the model's size in
the time of its stage, so a longer `time` shows a spring bringing it back more
slowly. `pull: [0, 0]` lets a body go without pulling it. A stage after a pull
begins where the pull left the body.

A model with springs, stops or locks and no `move` driver is solved by the contact
step over the cycle of its motor, or at its starting position alone when nothing
is driven.

## Measures (phases 2–3, built)

| Function | Result |
|---|---|
| `gap(a, b)` | mekasim's own by now. Smallest distance between the shapes of two bodies; negative where they overlap, by how much; never less than 0 for two bodies joined by a pin |
| `force(name)` | The force pressing the parts of a contact together, the tension of a straight spring (less than nothing when it pushes), or the force a `move` driver puts on its body |
| `torque(name)` | The torque of a spring on a joint, counted the joint's positive way; what a `move` driver turns its body with, about the origin of its frame; or the torque of a motor |
| `latched(lock)` | 1 while the lock is in, 0 while it is out |
| `final(e)`, `first(e)` | The value at the last and the first sample |

Conditions (`a < b`, `and`, `or`, `not`) and the `checks:` section are mekasim's,
described in [../mekasim/FORMAT.md](../mekasim/FORMAT.md). A check on something that varies has to
hold at every sample; `final(...)` asks for it at the end of the run only, which is
what most checks on a contact run want.

`gap` is drawn on the sheet as a dimension between its two nearest points, as
`dist` is now.

Forces are those that hold the parts in balance at each sample, so they come from
springs and pulls: in a model with neither, every force is zero, and the model says
so. A contact, a spring and a driver that are asked about need different names.
Asking `force` of something that turns, or `torque` of something that pushes in a
line, says which to use. The force of a contact that touches in several places is
all of them added up.

The app shows a force in N and a torque in N·mm, or in N·m where the model's length
is not millimetres. How hard a stop or a lock is held has no measure; the Springs
and locks fold shows it.

## Studies (phase 4, built)

```yaml
studies:
  coupling:
    runs: 500
    seed: 1
    sample: spread
    vary:
      dx: { from: -8 mm, to: 8 mm }
      turn: { mean: 0 deg, spread: 1.5 deg }
      a_open: { pick: [0 deg, 70 deg] }
      b_open: { pick: [0 deg, 70 deg] }
```

A study solves the model many times, each time with different values of some
parameters, and tests every run against the model's `checks`. A run passes when
all of them are met.

| Field | Meaning |
|---|---|
| `runs` | How many runs |
| `seed` | Starting number for the random draws. The same model text and seed always give the same runs |
| `sample` | `random`; `spread` (default) covers the ranges evenly with fewer runs, as a Latin hypercube does; `grid` takes every combination of `steps` values per parameter |
| `vary` | Parameters to vary. As a list, each over its own `min` to `max`. As a map, each with its own range |
| `pass` | Optional: named conditions for this study alone, written as checks are, tested instead of the model's `checks` |

A parameter's range is one of:

| Range | Values |
|---|---|
| `{ from, to }` | Evenly anywhere between |
| `{ mean, spread }` | Normal, with `spread` the standard deviation, cut off at the parameter's bounds |
| `{ pick: [...] }` | One of these values, each as likely |
| `{ from, to, steps }` | For `sample: grid` |

A run that cannot be solved is not a failure of the mechanism: it is counted apart
as "could not be solved" with the message, so a gap in the solver is not mistaken
for a gap in the design.

As built:

- `runs` is 100 and `seed` 1 when left out. A grid takes every combination and
  ignores `runs`; a parameter listed by name in a grid takes 5 steps from its `min`
  to its `max`.
- A parameter varied by name needs `min` and `max`. Every range keeps within the
  parameter's bounds, and a normal one is cut off at them.
- Each run's values are written into `params` in the model's units, as a slider
  writes them, and the model is solved as it is.
- A run in which parts jam is solved: the jam is what the mechanism does, and the
  conditions say whether it passed. A model that cannot be put together, a step
  that does not settle, or a condition that cannot be worked out is "could not be
  solved".
- `pass` replaces `checks` for the study's runs; the model's checks are then not
  tested.
- `pnpm fit:study <model> <study> [--runs N] [--csv out.csv]` runs a study from the
  command line, in worker threads, and prints what it came to.

`coupler-trial` in [`examples/fit/`](../../examples/fit), Thomas's coupler from
its drawings, has a study, `coupling`, over the sideways offset and how far each
coupler starts open; the simplified `knuckle-coupler` has a smaller one.
