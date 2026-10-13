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

This page is written ahead of the build. The phase that adds each part is given in
its heading (see [PLAN.md](PLAN.md)); mark a part as built when its phase is done.

Built so far: the first line `mekafit: 1`. Shapes are mekasim's own by now, written
out as `path` or taken from a DXF drawing with `geometry:`, `from`, `layer`, `at`
and `place` ([../mekasim/FORMAT.md](../mekasim/FORMAT.md), "Shapes" and "Shapes
from a drawing"), and so are `checks:` and conditions. The sections on shapes below
are kept for what mekasim does not have yet: SVG drawings, `plate` and `copy`
(`fit` is mekasim's too by now, and so is `gap(a, b)`). The `contacts:` forms below
are built and compile to checked, distinct pairs; their run results and interface
are still to come. Everything after contacts is still to come.

## A whole example

A knuckle coupler, modelled once and placed a second time turned round. The
outlines come from `coupler.dxf`, kept beside the model, where the head and the
knuckle were drawn on layers of their own.

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

## Shapes (phase 1)

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

## Contacts (phase 2; format and pair compilation built)

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

Without contact solving (no `move` driver, no springs, no locks), contacts are only
checked: a pair that runs into each other is reported with the step and the place.

| Field | Meaning |
|---|---|
| `between` / `among` | The bodies, as above |
| `friction` | Phase 5. Coefficient of friction; default 0 |

## Joint stops (phase 3)

```yaml
joints:
  pin: { type: revolute, connect: [head.K, knuckle.K], stops: [0 deg, 70 deg] }
  guide: { type: pin-slot, axis: [ground.A, ground.B], point: ram.P, stops: [0 mm, 120 mm] }
```

`stops` limits a revolute joint's relative angle, or the travel along a pin-slot or
slider measured from the first axis point. Either end may be `null`.

## Springs (phase 3)

```yaml
springs:
  opener: { joint: pin, stiffness: 0.02 N*m/rad, rest: 70 deg }
  return: { connect: [ram.P, ground.Q], stiffness: 2 N/mm, length: 40 mm }
```

A torsion spring on a revolute joint, or a straight spring between two points.
`rest` is the joint angle and `length` the length at which it pushes nothing.
`preload` instead of `rest` or `length` gives the torque or force at the starting
position. New units: `N`, `N*m`, `N*mm`, `N/mm`, `N*m/rad`, `N*mm/deg`.

## Locks (phase 3)

```yaml
latches:
  lock: { joint: pin, at: 2 deg, drops: down, engaged: false }
```

A lock that drops in behind a joint, as the lock block of a coupler drops behind
the knuckle's tail. When the joint's angle (or travel) passes `at` going the way
`drops` says, the lock is in, and from then on the joint cannot go back past `at`.

| Field | Meaning |
|---|---|
| `joint` | A revolute joint, pin-slot or slider |
| `at` | Where it drops in |
| `drops` | `down`: it drops in as the value falls below `at`, and then holds it below. `up`: the other way round |
| `engaged` | Whether it is in at the start; default `false` |

## Moving a body (phase 3)

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
`cycle.steps` gives the number of samples over all stages together, and more are
added where parts move fast against each other. Plots are drawn against time.

## Measures (phases 2–3)

| Function | Result |
|---|---|
| `gap(a, b)` | mekasim's own by now. Smallest distance between the shapes of two bodies; negative where they overlap, by how much; never less than 0 for two bodies joined by a pin |
| `force(name)` | Contact force of a contact pair, force of a spring, or the force a `move` driver needs (its torque in a turning stage is `torque(name)`) |
| `latched(lock)` | 1 while the lock is in, 0 while it is out |
| `final(e)`, `first(e)` | The value at the last and the first sample |

Conditions (`a < b`, `and`, `or`, `not`) and the `checks:` section are mekasim's,
described in [../mekasim/FORMAT.md](../mekasim/FORMAT.md). A check on something that varies has to
hold at every sample; `final(...)` asks for it at the end of the run only, which is
what most checks on a contact run want.

`gap` is drawn on the sheet as a dimension between its two nearest points, as
`dist` is now.

## Studies (phase 4)

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
