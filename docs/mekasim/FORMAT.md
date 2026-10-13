# The mekasim model format

A model is one YAML file, by convention named `something.mekasim.yaml`. This page
describes format version 1. Working examples are in [`examples/`](../../examples).

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
  description: A crank that moves a ram along a line
  units: { length: mm, angle: deg }

params:                     # named values
  r: 15 mm
  L: 420 mm

bodies:                     # rigid bodies and their points
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

frames:                     # other coordinates to measure in, optional
  from_pin: { origin: crank.A }

measures:                   # what to compute
  stroke: range(x(rod.B))

checks:                     # what the motion has to meet, optional
  long_enough: stroke > 70 mm

plots:                      # what to chart over the cycle
  ram: [x(rod.B), vx(rod.B)]

pose:                       # where bodies start
  rod: [r, 0, 0]
```

In `meta`, `name` is the title the model goes by and `description` a note kept
with it; `units` is explained below.

Names of parameters, bodies, points, joints, drivers, frames, measures and checks may contain
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

**Conditions:** `a < b`, `a <= b`, `a > b` and `a >= b` give 1 where they hold and 0
where they do not. Both sides must be the same kind of quantity; a bare number
takes the unit of the other side, so `r > 30` asks for more than 30 mm. `and`, `or`
and `not` join conditions: `r > 30 and r < 2 * base`. Arithmetic is worked out
first, then the comparisons, then `not`, then `and`, then `or`; brackets change
that. Compare two values at a time: `a < b and b < c`, not `a < b < c`.

A parameter can be given bounds, the least and the most it may be:

```yaml
params:
  gear: { value: 1, min: -1, max: 1 }
  r: { value: 40 mm, min: 20 }
```

Either bound may be left out. A bound without a unit is read in the unit of the
value. A value outside its bounds is an error. In the app the parameter's slider
runs between its bounds, and comparing values starts with the whole allowed range.

Parameters may refer to each other in any order. `pi`, `g`, `t`, `and`, `or` and
`not` cannot be used as parameter names.

## Bodies

```yaml
bodies:
  coupler:
    points: { A: [0, 0], B: [160, 0], P: [80, 60] }
    layer: 1
```

The `bodies` section may be left out of a model made only of components.

A body is a rigid set of named points, each given as `[x, y]` in the body's own
frame. The distances between its points are the body's dimensions.

`ground` is the fixed body; its points are world coordinates.

`layer` (an integer) orders bodies in depth for the 3D view and does not affect the
motion. Leave it out and layers are worked out so that no two bodies on one layer
run into each other: bodies that share a joint are kept apart, and so are bodies
whose plates overlap at any instant of the cycle. Each takes the lowest layer that
leaves free.

A point is referred to elsewhere as `body.point`, for example `coupler.P`.

### Shapes

```yaml
bodies:
  rocker:
    points: { B: [0, 0], O: [110, 0] }
    shape:
      path: "M 0 -9 L 110 -9 A 9 9 0 0 1 110 9 L 0 9 A 9 9 0 0 1 0 -9 Z"
      holes: { B: 6 mm, O: 6 mm }
```

A body is drawn as a plate round its points. `shape` gives it its real outline
instead. It is optional, and it does not change the motion: the points and the
joints do that. The shape is what is drawn, and what is exported as the part.

| Field | Meaning |
|---|---|
| `path` | Closed outlines as path text, in the body's frame and the document unit. The largest is the outside; outlines inside it are cut out |
| `holes` | Round holes, each at a named point of the body, with its diameter. A diameter may be an expression |

The path text is the part of SVG path data that real outlines need:

| Command | Meaning |
|---|---|
| `M x y` | Start an outline at a point |
| `L x y`, `H x`, `V y` | Straight line to a point, or along x or y |
| `A r r 0 large sweep x y` | Arc of a circle with radius `r` to a point. Both radii must be equal and the turn 0. `large` is 1 for the longer way round, `sweep` 1 for anticlockwise |
| `Z` | Close the outline |

Coordinates are plain numbers in the document unit; expressions are not read
inside a path, so an outline does not follow a parameter. Small letters (`l`, `h`,
`v`, `a`) give steps from the last place, as in SVG. A whole circle is two arcs.
Put the path in quotes.

Every outline must be closed, and outlines must not cross themselves or each other;
a hole must lie inside the outside. A problem is reported with the place on the
outline where it is.

### Shapes from a drawing

```yaml
geometry:
  links: { file: four-bar-links.dxf }
  pawl: { file: pawl.dxf, unit: mm }

bodies:
  crank:
    points: { O: [0, 0], A: [40, 0] }
    shape: { from: links, layer: CRANK, place: [20, 20, 0] }
  rocker:
    points: { B: [0, 0], O: [110, 0] }
    shape: { from: links, at: [80, 150], place: [30, 150, 15 deg] }
```

An outline can be taken from a DXF drawing in place of being written out.
`geometry` names the drawings the model uses. They are files kept beside the model,
not copied into it, so that a drawing exported again from CAD takes the place of the
old one and the model follows.

| Field | Meaning |
|---|---|
| `file` | The name of a DXF file. In the app it is attached to the model; on the command line it is looked for in the model's folder |
| `unit` | Length unit of the drawing, when the file does not say: `mm cm m in` |

A body's `shape` then says which outline it is:

| Field | Meaning |
|---|---|
| `from` | A name from `geometry` |
| `layer` | The layer of the drawing the outline is on. With one closed outline on the layer, that is the shape, with the outlines inside it cut out |
| `at` | `[x, y]`, a point inside the wanted outline, in the drawing's coordinates. Needed when the layer has more than one outline, or when no layer is given |
| `place` | `[x, y, angle]`: where the body's own frame sits in the drawing. Default `[0, 0, 0]`, which is right for a part drawn round its own origin |
| `holes` | Round holes added at named points, as for a shape written out |

`at` and the place of `place` are plain numbers in the drawing's own coordinates,
not expressions over parameters.

Of a drawing, lines, arcs, circles and polylines are read, and blocks are put in
where they are inserted. Text, dimensions and hatches are left out, and so, for
now, are splines and ellipses. Lines that meet end to end within a hair's breadth
are joined into outlines; an outline that does not close cannot be a shape, and is
reported with the two ends it is open between. The app shows what each drawing
holds, layer by layer, in the Geometry tab beside the source.

A drawing that is not attached is not an error: the model runs, and the bodies that
take their shape from it are drawn as plates until it is. A link to a model carries
no files, so the shapes are written out into it as `path`.

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
| `distance` | `connect: [a.P, b.Q]`, `length` | Keeps the two points a fixed distance apart: a link without a body. Also the way to keep a pin in a curved slot, with the slot's centre as one of the points |
| `gear` | `connect: [a.O, b.O]`, `sizes: [20, 40]`, `carrier` | Ties the rotation of two bodies as meshing gears do: they turn against each other, in the ratio of their sizes |
| `belt` | `connect: [a.O, b.O]`, `sizes: [50 mm, 150 mm]`, `carrier` | As `gear`, but the two turn the same way, as on a belt or chain |
| `cam` | `cam`, `follower`, `base`, `profile`, `law`, `roller` | Keeps a follower point on the pitch curve of a cam; see below |

The two axis points must be on the same body and define the line of travel; the
line is unbounded. The two sides of a joint must be different bodies.

### Gears and belts

`connect` names the centres of the two wheels: a point on each body, at the axis it
turns about. The joint only ties the rotations together; each body still needs its
own pin to hold it in place. `sizes` are tooth counts or diameters; only their
ratio matters. Angles are measured relative to `carrier`, the body both axes sit
on, which is the ground unless given (give it for a planet gear on an arm).

### Cams

```yaml
contact:
  type: cam
  cam: camshaft.O             # the cam's centre, a point on the cam's body
  follower: lifter.P          # the follower's roller centre
  base: 30 mm                 # centre to roller centre at zero lift
  roller: 8 mm                # roller radius, for the drawing
  profile: [[0, 0], [120, 12], [180, 12], [300, 0]]
  law: cycloidal
```

`profile` is the lift diagram: `[angle, lift]` pairs around the cam, in rising
order of angle from 0 to below a full turn. Between two pairs the lift moves from
one value to the other by `law`; between two pairs with the same lift it stays
level; from the last pair round to the first it does the same.

| Law | Motion between two pairs |
|---|---|
| `cycloidal` (default) | Starts and ends with no speed and no acceleration |
| `polynomial` | The 3-4-5 polynomial: likewise, with a lower peak acceleration |
| `harmonic` | Simple harmonic: no speed at the ends, but acceleration jumps there |

The curve described is the pitch curve, the path of the roller centre seen from the
cam. The cam plate is drawn one roller radius inside it.

The follower always stays on the cam. A follower that would lift off in reality,
because nothing holds it down, does not lift off here.

The cam joint only keeps the follower on the curve: the follower still needs its
own joint, a slider to move in a line or a pin to swing.

## Components

```yaml
components:
  eccentric:
    type: crank
    at: [0, 0]
    arms: { A: [ecc, 90] }
    speed: rpm
  rocker:
    type: crank
    at: [500, 0]
    arms: { D: [60, 90], U: [120, 90], L: [120, 270] }
  pitman:
    type: rod
    length: 502 mm
    connect: [eccentric.A, rocker.D]
```

A component is a common part given by its dimensions rather than by the positions
of its points. Each stands for a body with its joints, so everything else in the
model can use it as a body: `rocker.U` is a point, `angle(rocker)` a measure.
Nothing about a component is beyond what can be written out by hand; it is shorter
and needs no coordinates and no `pose`.

### crank

A body turning about a pivot, with points given by radius and angle. It serves as
an eccentric shaft, a rocker, a bellcrank or a hanger.

| Field | Meaning |
|---|---|
| `at` | Where it pivots: a fixed position `[x, y]`, or a point on another body |
| `arms` | Named points, each as `[radius, angle]`. `O` is the pivot itself |
| `angle` | How far the whole crank is turned at the start; default 0 |
| `speed` | Drive it at this speed (rpm unless a unit is given). Leave out for a crank that is moved by the rest |
| `layer` | As for a body |

It stands for a body named as the component, a pin of the same name at its pivot
(on a ground point of the same name when `at` is a position), and a driver of the
same name when `speed` is given.

### rod

A link given by its length and the two points it is pinned to.

| Field | Meaning |
|---|---|
| `length` | Distance between its two ends |
| `connect` | The two points its ends `A` and `B` are pinned to |
| `points` | Further points in the rod's frame, where `A` is `[0, 0]` and `B` is `[length, 0]`: a coupler point, for example |
| `layer` | As for a body |

It stands for a body with points `A` and `B` and two pins named `<rod>_a` and
`<rod>_b`. It starts with `A` on the first point, pointing at the second.

An expression that contains a comma, such as `hypot(500, 45)`, cannot be written
inside `{ ... }`: put the component's fields on lines of their own, or put the
expression in quotes.

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
| `x(p)`, `y(p)` | Position of a point, or of the centre of a body |
| `r(p)`, `theta(p)` | The same position as a radius and an angle: how far the point is from the origin, and in which direction |
| `vx(p)`, `vy(p)`, `v(p)` | Velocity components and speed of a point |
| `vr(p)`, `vt(p)` | Velocity along the radius, and across it |
| `ax(p)`, `ay(p)`, `a(p)` | Acceleration components and magnitude of a point |
| `ar(p)`, `at(p)` | Acceleration along the radius, and across it |
| `jx(p)`, `jy(p)`, `j(p)` | Jerk components and magnitude of a point: how fast its acceleration changes |
| `jr(p)`, `jt(p)` | Jerk along the radius, and across it |
| `dist(p, q)` | Distance between two points |
| `moved(p)` | How far a point is from where it started, whichever way it went |
| `angle(body)` | Angle of a body |
| `angle(p, q)` | Direction of the line from `p` to `q` |
| `angle(p, q, r)` | Angle at `q`, turning from `p` to `r` |
| `omega(body)`, `alpha(body)` | Angular velocity and acceleration of a body |
| `t` | Time |

Wherever a function takes a point it also takes a body, written without a point:
`x(rocker)`, `v(upper_deck)`, `dist(upper_deck, lower_deck)`. The body then stands
for its centre, the middle of its points. `angle(body)` gives how far it is turned.

`change(e)` counts a value from where it started: the value at each instant less
its value at the start of the cycle. `change(x(deck))` is how far the deck has moved
sideways from its starting position, `change(angle(rocker))` how far the rocker has
turned.

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

Results are shown in document units: `mm`, `deg`, `mm/s`, `mm/s²`, `mm/s³`, `deg/s`.

A condition in a measure is 1 or 0 at every sample, so its `mean` is the share of
the cycle over which it holds: `mean(vx(ram.P) > 0)` is how much of a turn the ram
spends going forward, `mean(y(foot.P) < 2 mm)` how much of it a foot is down.

## Checks

```yaml
checks:
  long_enough: stroke > 70 mm
  gentle: max(a(deck.F)) < 3 * g
  clears_frame: dist(rocker.B, ground.post) > 15 mm
  slow_cut: mean(vx(ram.P) > 0) > 0.6
```

A check is a condition the motion has to meet, written as an expression like a
measure, with the measures usable by name. The app shows each check as met or not
met, and keeps doing so while a parameter is changed, so that it is seen at once
when a change breaks what the mechanism is for.

- A check that is one value for the whole cycle, such as `stroke > 70 mm`, is met
  when it holds.
- A check that varies over the cycle, such as `dist(rocker.B, ground.post) > 15 mm`,
  has to hold at every step. Where it does not, the app says at how many steps and
  shows the first of them.

A check that is not met is a result, not an error: the model still runs. A check
must be a condition; `stroke` on its own is reported, since a length is neither met
nor not met. A check and a measure cannot have the same name. Later checks and
plots can use a check by name, as 1 or 0.

## Frames

```yaml
frames:
  slope:    { origin: ground.O, along: [ground.O, ground.S] }
  tilted:   { angle: 30 }
  from_cam: { origin: camshaft.O, body: camshaft }

measures:
  travel: range(x(ram.P, slope))
  lift: r(lifter.P, from_cam)
```

Positions are counted from the origin of the sheet, along its x and y. A frame is
another set of coordinates to give them in. Name it as a second argument of any
function of one point: `x(p, frame)`, `vr(p, frame)`, `moved(p, frame)`.

| Key | Meaning |
|---|---|
| `origin` | The point positions are counted from. Left out, it is the origin of the sheet |
| `angle` | How far the x axis is turned, anticlockwise. Left out, it is 0 |
| `along` | Two points. The x axis points from the first to the second, and `angle` turns it on from there |
| `body` | A body. The x axis is that of the body's own frame and turns with it, and `angle` turns it on from there |

Give `along` or `body`, not both. Without either the axes keep to the sheet.

A frame may stand still or move. With its origin on a point of a moving body, or
turning with one, it shows the motion as seen from there: the velocity is the rate
at which the coordinates in the frame change, not the velocity over the sheet. A
point of a body, seen from a frame on that body, stands still. Seen from a cam, its
follower goes round at a radius of the base circle plus the lift.

A sloping slide is read along its own axis this way: `x(p, slope)` is the travel,
`vx(p, slope)` its speed, and `y(p, slope)` stays 0.

The functions `r`, `theta`, `vr`, `vt`, `ar`, `at`, `jr` and `jt` give the same
motion in polar coordinates about the frame's origin, with the angle counted from
the frame's x axis. `vr` is how fast the radius grows and `vt` the speed across it,
the radius times the rate of the angle. `ar` and `at` are the parts of the
acceleration in those two directions, so `ar` includes the pull towards the centre
of a point going round, and `at` the Coriolis term. `theta` runs on past a full
turn instead of jumping back, like `angle`.

## Plots

```yaml
plots:
  decks: [x(upper_deck.F), x(lower_deck.F)]
  upper_accel: a(upper_deck.F)
  gap: gap
```

A plot is a chart over the cycle of one expression or a list of them. The
expressions are the same as in measures, and may use measures and checks by name.

Charts are drawn against the angle of the first driver. A plot whose expressions
have different units is drawn as one chart per unit, since values on two different
scales cannot be compared on one chart. Up to eight expressions per plot are drawn.

Every plotted expression is also a column of the CSV output.

## Fabrication

```yaml
fabrication:
  width: 20 mm        # width of a link
  thickness: 5 mm     # thickness of the sheet or print
  hole: 6 mm          # diameter of the pins
  clearance: 0.2 mm   # added to each hole so that a pin turns freely
```

The real dimensions of the parts. Each is optional. Where one is given, the
drawing uses it, so links are shown true to size; where it is left out, the
drawing picks a size that suits the model on screen. They do not affect the motion.

Where two pinned points of one body are closer together than a pin is wide, as on
an eccentric with a small throw, those pins and their holes are made smaller so
that they fit side by side.

The app exports the parts as flat pieces with these dimensions: a DXF drawing to
cut and an STL solid to print. Each moving body becomes a plate round its points
with a hole at every pinned point; a slider or pin-slot gives a slot as long as the
pin travels; a cam becomes a plate of its own; the ground becomes a base plate
carrying the fixed pivots.

A body with a `shape`, written out or from a drawing, is exported as drawn: its outline with the holes it gives,
and nothing added. Give it its own holes for the pins. In the DXF its arcs are
polygons with many sides, as the rounded plates are.

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
