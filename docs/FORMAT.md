# The mekasim model format

A model is one YAML file, by convention named `something.mekasim.yaml`. This page
describes format version 1. Working examples are in [`examples/`](../examples).

Solve a model from the command line:

```
pnpm solve examples/four-bar.mekasim.yaml
pnpm solve examples/four-bar.mekasim.yaml --csv out.csv
```

## Overview

```yaml
mekasim: 1                  # format version, required
meta:                       # optional
  name: Slider-crank
  units: { length: mm, angle: deg }

params:                     # named values
  r: 15 mm
  L: 420 mm

bodies:                     # rigid bodies and their points, required
  ground:
    points: { O: [0, 0], X: [1, 0] }
  crank:
    points: { O: [0, 0], A: [r, 0] }
  rod:
    points: { A: [0, 0], B: [L, 0] }

joints:                     # how the bodies are connected
  main:  { type: revolute, connect: [ground.O, crank.O] }
  pin:   { type: revolute, connect: [crank.A, rod.A] }
  guide: { type: pin-slot, axis: [ground.O, ground.X], point: rod.B }

drivers:                    # what makes it move
  motor: { joint: main, speed: 300 }

traces: [rod.B]             # points whose paths are recorded

measures:                   # what to compute
  stroke: range(x(rod.B))

plots:                      # what to chart over the cycle
  ram: [x(rod.B), vx(rod.B)]

pose:                       # where bodies start
  rod: [r, 0, 0]
```

Names of parameters, bodies, points, joints, drivers and measures may contain
letters, digits and `_`, and must not start with a digit. Unknown keys are errors,
so a typo is reported instead of ignored.

YAML is read strictly as version 1.2: `no`, `on` and `yes` are ordinary text, and a
key that appears twice is an error. JSON files are accepted too.

## Units and expressions

Any number in a model can be an expression.

| You write | Meaning |
|---|---|
| `40` | 40 in the document unit of whatever the field expects (mm for a length by default) |
| `40 mm`, `4 cm`, `1.5 in` | A length with an explicit unit |
| `r` | The parameter `r` |
| `2 * r + 10` | Arithmetic: `+ - * / ^` and parentheses |
| `r * cos(30 deg)` | Functions |

**Units** follow a number directly: `mm cm m in` (length), `deg rad rev` (angle),
`rpm rad/s deg/s Hz` (rotation speed), `s ms` (time), `kg g` (mass). A unit can only
follow a number, never a name or a bracket; write `2 * r`, not `2 r`.

**Document units** are set in `meta.units`: `length` is one of `mm cm m in`
(default `mm`), `angle` is `deg` or `rad` (default `deg`). They decide how bare
numbers are read and how results are shown.

**Dimensions are checked.** `r + 30 deg` is an error when `r` is a length. A bare
number next to a quantity takes that quantity's document unit, so `r + 10` adds
10 mm. Trigonometric functions read a bare number as an angle in the document unit:
`sin(30)` is 0.5 in a degree document.

**Functions:** `sin cos tan asin acos atan atan2 sqrt abs hypot min max`.
`pi` and `g` (standard gravity, 9.80665 m/s²) are built in.

Parameters may refer to each other in any order. `pi`, `g` and `t` cannot be used
as parameter names.

## Bodies

```yaml
bodies:
  coupler:
    points: { A: [0, 0], B: [160, 0], P: [80, 60] }
    layer: 1
```

A body is a rigid set of named points, each given as `[x, y]` in the body's own
frame. The distances between its points are the body's dimensions.

`ground` is the fixed body; its points are world coordinates. `layer` (an integer,
default 0) orders bodies in depth for the 3D view and does not affect the motion.

A point is referred to elsewhere as `body.point`, for example `coupler.P`.

### Two ways to describe a mechanism

**By dimensions.** Give each body in a convenient frame of its own, typically with
one point at `[0, 0]` and the next along x, and say roughly where it starts in
`pose`. See `examples/four-bar.mekasim.yaml`.

**As drawn.** Give every point of every body in world coordinates, at the position
the mechanism is drawn in. Each body's frame then coincides with the world at the
start, so no `pose` is needed, and the drawn position is the position at time 0.
See `examples/shaker.mekasim.yaml`.

The two can be mixed.

## Joints

| Type | Fields | Effect |
|---|---|---|
| `revolute` | `connect: [a.P, b.Q]` | Pins the two points together; the bodies can rotate about the pin |
| `weld` | `connect: [a.P, b.Q]`, `angle` | Holds the two points together and fixes the angle of the second body relative to the first (default 0) |
| `pin-slot` | `axis: [a.P1, a.P2]`, `point: b.Q` | Keeps the point on the line through the two axis points; the point's body can still rotate |
| `slider` | `axis: [a.P1, a.P2]`, `point: b.Q`, `angle` | As `pin-slot`, and also fixes the angle of the sliding body relative to the axis body (default 0) |

The two axis points must be on the same body and define the line of travel; the
line is unbounded. The two sides of a joint must be different bodies.

## Drivers

```yaml
drivers:
  motor: { joint: main, speed: 300, phase: 0 }
```

A driver turns a revolute joint at constant speed. The angle of the joint's second
body relative to its first is `phase + speed * time`.

- `speed`: in rpm unless a unit is given (`10 rad/s`, `5 Hz`). Positive is
  counter-clockwise. `0` holds the joint at `phase`.
- `phase`: relative angle at time 0, default 0. With a model written as drawn,
  0 means "start where it is drawn".

## Cycle

```yaml
cycle: { steps: 720, revolutions: 2 }
```

The motion is sampled at `steps` evenly spaced instants (default 360) over
`revolutions` turns of the first driver (default 1). Without a moving driver only
the starting position is solved.

## Pose

```yaml
pose:
  coupler: [40, 0, 40]      # x, y, angle of the body frame
  rocker: [160, 110, -80]
```

The position each body starts from, as the world position of its frame origin and
its angle. Bodies not listed start at `[0, 0, 0]`. It is a starting guess, not a
constraint: the solver moves the bodies from there until every joint closes.

It matters because most mechanisms can be assembled in more than one way (a
four-bar open or crossed), and the solver settles on the one nearest the guess.
Rough values are enough.

## Traces

```yaml
traces: [coupler.P, rocker.B]
```

Points whose paths are recorded over the cycle. They are written to the CSV output
as x and y columns.

## Measures

```yaml
measures:
  stroke: range(x(rod.B))
  swing: range(angle(rocker))
  peak_accel: max(a(coupler.P))
  gap: dist(upper.F, lower.F)
```

A measure is an expression over the motion. These functions take bodies and points
and give a value at every sample of the cycle:

| Function | Result |
|---|---|
| `x(p)`, `y(p)` | Position of a point |
| `vx(p)`, `vy(p)`, `v(p)` | Velocity components and speed of a point |
| `ax(p)`, `ay(p)`, `a(p)` | Acceleration components and magnitude of a point |
| `dist(p, q)` | Distance between two points |
| `angle(body)` | Angle of a body |
| `angle(p, q)` | Direction of the line from `p` to `q` |
| `angle(p, q, r)` | Angle at `q`, turning from `p` to `r` |
| `omega(body)`, `alpha(body)` | Angular velocity and acceleration of a body |
| `t` | Time |

These reduce a value over the cycle to one number:

| Function | Result |
|---|---|
| `min(e)`, `max(e)` | Smallest and largest value |
| `range(e)` | `max - min`: a stroke or a swing |
| `mean(e)` | Average |

With more than one argument, `min` and `max` compare sample by sample instead.

All of it combines with ordinary arithmetic and parameters:
`range(x(upper.F) - x(lower.F))`, or `max(a(deck.F)) / g` for a peak acceleration
as a multiple of gravity.

A measure can use the measures above it by name:

```yaml
measures:
  gap: dist(upper.F, lower.F)
  gap_swing: range(gap)
```

A measure that is not reduced is a signal: the command line shows its starting
value and writes the whole signal as a CSV column.

Results are shown in document units: `mm`, `deg`, `mm/s`, `mm/s²`, `deg/s`.

## Plots

```yaml
plots:
  decks: [x(upper_deck.F), x(lower_deck.F)]
  upper_accel: a(upper_deck.F)
  gap: gap
```

A plot is a chart over the cycle of one expression or a list of them. The
expressions are the same as in measures, and may use measures by name.

Charts are drawn against the angle of the first driver. A plot whose expressions
have different units is drawn as one chart per unit, since values on two different
scales cannot be compared on one chart. Up to eight expressions per plot are drawn.

Every plotted expression is also a column of the CSV output.

## Messages

Every problem is reported with the line it comes from.

| Message | Meaning |
|---|---|
| `Body "x" has no point "y"`, `Unknown parameter`, ... | A mistake in the text |
| `N degrees of freedom and no driver` | The mechanism can move but nothing moves it; only the start is solved |
| `N degrees of freedom not driven` | More freedom than drivers; the listed bodies are not fully determined |
| `N redundant constraints` | Some joints repeat what others already enforce. Motion is unaffected. Common and harmless in planar models of real machines |
| `Driver "x" has nothing to move` | The joints alone already lock the bodies the driver acts on |
| `cannot be assembled from its starting position` | No position near `pose` closes all joints: check the dimensions, or give a better `pose` |
| `locks up at step N` | The motion cannot continue past this point, for example a crank that cannot make a full turn |

## Editor support

`packages/core/schema/mekasim-1.schema.json` is a JSON Schema of the format. Editors
with YAML language server support (for example VS Code with the YAML extension)
validate and autocomplete a model that starts with:

```yaml
# yaml-language-server: $schema=../packages/core/schema/mekasim-1.schema.json
```
