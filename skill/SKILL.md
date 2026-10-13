---
name: mekasim
description: Write a planar mechanism (a linkage, slider, cam or gear train) as a mekasim YAML model that the user pastes into the mekasim app to see it move, measured and plotted. Use when the user asks to draw, model, design or simulate a mechanism for mekasim, or asks for a `.mekasim.yaml` file.
---

# Drawing mechanisms for mekasim

mekasim is a browser app that solves and animates planar mechanisms written as one
YAML file. The user describes a mechanism; you answer with a complete model that
they paste into the app's Source panel. The app then draws it, moves it through a
cycle, and shows its measures and plots.

You cannot run the app. What you write has to be right from the geometry alone, so
work the numbers out before you write them down.

## What to hand over

- One fenced `yaml` block holding the whole file, from `mekasim: 1` to the end.
  Never a fragment or a diff, also when you correct an earlier answer: the user
  replaces the whole source each time.
- A comment at the top of the file that says what the mechanism is and how it
  works, and comments on the parameters that are worth changing.
- Around the block, briefly: what you built, any dimensions you had to choose
  yourself, and which measure or plot shows what the user asked about.
- Do not say that it works or quote results. You have not seen it run. Say what
  the user should see, and ask them to paste back anything the Messages list under
  the source reports.

## How to build a model

Work in this order.

**1. Name the parts.** List the rigid bodies, what joins them, and what drives it.
One driven crank turning at a steady speed is the usual input.

**2. Count the freedom.** Every moving body brings 3. Each joint takes some away:

| Joint | Takes away |
|---|---|
| `revolute` | 2 |
| `slider` | 2 |
| `weld` | 3 |
| `pin-slot`, `distance`, `gear`, `belt`, `cam` | 1 |

What is left must equal the number of drivers, normally 1. A `crank` component
brings its own pin (2); a `rod` component brings its two pins (4), so a rod takes
away 1 overall. If the count is off, a link or a joint is missing or one too many.

**3. Choose dimensions that can run.** A driver turns its crank all the way round.
In a four-bar the crank can only do that if the shortest link plus the longest is
less than the other two together. A piston's rod must be longer than the crank.
If the user gives no dimensions, pick plausible ones in millimetres and say so.

**4. Write it with components where you can.** A `crank` is given by its pivot and
its arms as radius and angle, a `rod` by its length and the two points it joins.
They need no coordinates and no `pose`, and they are easy for the user to change.
Use a plain body under `bodies` for anything else: a slider, a piston, a part with
three or more pins that is not on a fixed pivot.

**5. Work out where everything starts.** This is where models go wrong.

- A driven crank starts at the angle of its arms.
- A crank that is moved by the rest needs `angle` set to where it really is at the
  start, to within some ten degrees. Work it out from the triangle the links make,
  and write it as an expression of the parameters where you can, so that it stays
  right when a parameter changes.
- A rod places itself: it starts on its first point, pointing at its second. It is
  only as right as those two points are.
- A plain body needs a `pose`: where its origin is and how far it is turned.
- Most mechanisms can be put together in more than one way: a four-bar open or
  crossed, a rocker above or below. The solver takes the one nearest to what you
  wrote, so a careless start gives the mirrored mechanism or none at all.

**6. Add what shows the point.** Put the interesting points in `traces`, and write
`measures` and `plots` for what the mechanism is for: a stroke with `range(...)`,
a swing, a peak speed, the position over the cycle. Where the user gave a
requirement, write it under `checks` as well, such as `long_enough: stroke > 70 mm`,
so the app shows whether it is met.

Where x and y on the sheet do not say it, add a frame under `frames` and name it
after the point: `x(p, slope)` for the travel along a sloping slide, with
`slope: { origin: ground.O, along: [ground.O, ground.S] }`, or `r(p, from_cam)` for
a follower seen from its cam, with `from_cam: { origin: cam.O, body: cam }`.

**7. Read it through once more** against the list of mistakes below.

## A worked example

"A crank-rocker: crank 40, coupler 160, rocker 110, pivots 180 apart."

Three moving bodies bring 9. The crank's pin, the rocker's pin and the two pins of
the coupler take away 8. One is left, for the motor. The shortest and longest
links make 40 + 180 = 220, the other two 270: the crank can go round.

The crank starts along the x axis, its pin 140 from the rocker's pivot. The
rocker, the coupler and that 140 make a triangle, so the angle at the rocker's
pivot follows from the law of cosines, and the rocker points up and back from
there.

```yaml
# A crank-rocker four-bar. The crank goes round; the rocker swings to and fro.
mekasim: 1
meta:
  name: Crank-rocker

params:
  rpm: 60
  r: 40 mm          # crank radius
  coupler: 160 mm
  rocker: 110 mm
  base: 180 mm      # between the two fixed pivots

components:
  crank:
    type: crank
    at: [0, 0]
    arms: { A: [r, 0] }
    speed: rpm
  rocker:
    type: crank
    at: [base, 0]
    arms: { B: [rocker, 0] }
    # Where it stands with the crank along the x axis, from the triangle of the
    # rocker, the coupler and the line from the rocker's pivot to the crank pin.
    angle: 180 - acos((rocker^2 + (base - r)^2 - coupler^2) / (2 * rocker * (base - r)))
  coupler:
    type: rod
    length: coupler
    connect: [crank.A, rocker.B]
    points: { P: [80, 50] }   # a point carried along by the coupler

traces: [coupler.P]

measures:
  swing: range(angle(rocker))
  peak_speed: max(v(coupler.P))

plots:
  rocker: angle(rocker)
```

## Mistakes to avoid

- **A comma inside `{ }` or `[ ]`.** YAML splits there, so `pose: [0, 0, atan2(a, b)]`
  and `{ length: hypot(a, b) }` break. Put such a value on a line of its own, or
  in quotes.
- **A unit after a name.** `2 * r` and `40 mm` are right; `r mm` and `2 r` are not.
- **Reserved names.** `g`, `pi` and `t` cannot be parameters. Names are letters,
  digits and `_`, and do not start with a digit.
- **Keys that do not exist.** An unknown key is an error. Use only what the format
  reference lists.
- **A rod joined to something that is not there.** Both points in a rod's
  `connect` must be points of other bodies or components. In a closed ring of
  links, at least one has to be a crank or a plain body.
- **A slider that is turned.** `slider` holds the sliding body at a fixed angle to
  the body that carries the axis, not to the axis. A piston on an upright axis
  still has angle 0, so give its points as they lie in the world: the crown at
  `[0, 30]`, above the pin.
- **A slider where a pin-slot is meant.** A connecting rod's end on a line is a
  `pin-slot`: the rod must stay free to turn.
- **Wheels with nothing to hold them.** `gear` and `belt` only tie two rotations
  together. Each wheel still needs its own pin, and the joint names the two
  centres. Gears turn against each other, a belt turns both the same way.
- **A cam read the wrong way round.** The profile is laid out anticlockwise round
  the cam. A cam turning anticlockwise therefore brings it past the follower
  backwards; turn the cam clockwise, or write the profile mirrored. The follower
  also needs its own slider or pin.
- **A mechanism that only rocks, driven directly.** Watt's linkage, a toggle or a
  pantograph cannot go all the way round. Rock it with a crank and a rod.
- **A gear ratio that does not come round in one turn.** Set `cycle.revolutions`
  to as many turns of the first driver as the whole needs to repeat.
- **Parts that let go.** Joints never open, so a ratchet, a Geneva wheel or
  anything else that works by touching and releasing cannot be modelled. Neither
  can anything that leaves the plane. Say so instead of approximating in silence.
- **Choosing between values.** There is no `if`. Use `min`, `max`, `abs`, `range`
  and `mean`. A condition such as `x(rod.B) > 40 mm` is 1 or 0; `mean` of it is the
  share of the cycle it holds for.
- **A shape nobody asked for.** `shape` on a body is its real outline as path text,
  for when the user gives one or wants parts to make. A linkage needs none: leave it
  out and the body is drawn as a plate round its points.
- **A check that is not a condition.** Every entry under `checks` compares
  something: `stroke > 70 mm`, not `stroke`.

## When the user reports a message

| Message | What to do |
|---|---|
| A parse error, an unknown key or name | Fix the spelling or the YAML at the line given |
| `cannot be assembled from its starting position` | The start is too far off, or the lengths cannot close. Recompute the starting angles and poses |
| `locks up at step N` | The crank cannot complete its turn with these lengths. Check step 3, or drive it through a crank and rod |
| `N degrees of freedom not driven` | A joint is missing. Recount as in step 2 |
| `Driver ... has nothing to move` | A joint too many. Recount |
| `N redundant constraints` | Harmless where it is meant, as with two parallel cranks carrying one bar; otherwise a joint too many |
| It runs, but as the mirror image or folded the wrong way | A starting angle or pose is on the wrong side. Move it to the side that is meant |

Then answer with the whole corrected file.
