# mekasim

Explore planar mechanisms: describe linkages, eccentrics and joints in a YAML file,
solve their exact motion and measure what they do.

There is a solver core with a command-line runner, and a browser app, mekasim, that
shows a model moving in 2D and 3D next to its source, with tools to draw it. A body
can carry its real outline, written out or taken from a DXF drawing, and the parts
can be exported to cut or print. See [docs/mekasim/PLAN.md](docs/mekasim/PLAN.md).

A second app in this repository, mekafit, is for mechanisms that work by parts
touching. It measures the gaps between the outlines of the parts, and solves models
in which listed parts push each other, with springs, joint stops, locks, and a
driver that carries a body and lets it go: a door latch, a ratchet, a knuckle
coupler and a push-to-open catch are among its [examples](examples/fit). Studies
over many starting positions are still to come. It shares the core and the
interface parts; its format is in [docs/mekafit/FORMAT.md](docs/mekafit/FORMAT.md),
and [docs/mekafit/PLAN.md](docs/mekafit/PLAN.md) says where it stands.

## Use

Requires Node 26 and pnpm 11.

```
pnpm install
pnpm dev         # both apps: mekasim at http://localhost:5173, mekafit at :5174
```

Edit the YAML on the left and the drawing, measures and messages follow. Or work
on the drawing and the YAML follows: changes are written into the text in place,
keeping its comments and layout.

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click to select; drag a part to move the mechanism |
| Link | L | Click points for a new link; Enter or a second click on the last point finishes |
| Crank | C | Click the pivot, then the end of the arm: a crank by radius and angle |
| Rod | O | Click two points to join them with a rod of that length |
| Pin | P | Pin overlapping points together, or a lone point to the ground |
| Slot | S | Click a point, then a direction: the point slides along that line |
| Tie | I | Hold two points a fixed distance apart |
| Gear | G | Gear two turning bodies together by their centres; a belt is one click away in the inspector |
| Cam | A | Click a cam's centre, then its follower's point; shape the lift in the inspector |
| Motor | M | Drive a pin, or remove its motor |
| Trace | T | Record the path of a point |
| Reshape | R | Drag a point to change its link; pinned points move along |
| Measure | D | Click two points for their distance, or a link for its angle |

Space plays and pauses, the arrow keys step through the cycle, Delete removes the
selection, Ctrl+Z undoes. "Copy link" puts the whole model into a link.

In the source, put the cursor on a name where it is defined (a link, a point, a
pin, a parameter, a measure): every place that uses it is marked, and what you type
into the name is typed into all of them.

Select a point or a link to plot its position, speed, acceleration or angle over
the cycle; "Export CSV" saves the motion as a table. "Compare values" on a parameter solves the model for
several values and draws them together. "Trace over a picture" lays an image under
the drawing, which is not saved with the model.

"AI skill" above the source opens a text that teaches an AI assistant to write
models: copy it into a conversation, or download it as a skill, describe a
mechanism, and paste the YAML it answers with into the source. The text is
[skill/SKILL.md](skill/SKILL.md) with the format reference and a few examples
added.

"Make" in the header takes the real width, thickness and pin size of
the links, and downloads them as flat pieces: a DXF to laser cut, and a 3MF or an STL
to print. The 3MF holds every piece as an object of its own, the STL all in one.
"Download DXF of the points" there saves the joints at the start of the cycle as
points, with the links as lines between them, to build on in a CAD program.

From the command line:

```
pnpm solve examples/shaker.mekasim.yaml
pnpm solve examples/shaker.mekasim.yaml --csv shaker.csv
pnpm solve examples/shaker.mekasim.yaml --dxf shaker.dxf
```

```
Counter-moving shaker decks
  7 moving bodies, 10 joints, 1 driver
  1 degree of freedom, fully determined
  360 of 360 steps solved over 0.214286 s

Measures
  rocker_swing      29.082 deg
  upper_stroke      60.2412 mm
  ...
```

The model format is described in [docs/mekasim/FORMAT.md](docs/mekasim/FORMAT.md); start from one
of the files in [`examples/`](examples). Besides links and pins a model can have
gears, belts, cams and fixed-distance ties, and cranks and rods given by their
dimensions instead of point positions.

## Related work

[PMKS+](https://github.com/PMKS-Web/Planar-Mechanism-Kinematic-Simulator) (MIT), from
Worcester Polytechnic Institute, is a browser simulator for planar linkages made for
teaching, at [pmksplus.com](https://pmksplus.com). It covers the same ground as
mekasim for links, pins, slots and slides: drawing, motion plots, traces, CSV and
share links. Noted here from its README, as of 2026-10-13:

- It has what mekasim does not: forces at rest and in motion (the reactions on each
  body and the torque or force at the input, with gravity and applied forces),
  checked against MATLAB reference cases; synthesis of a four-bar from three
  positions of its coupler; cylinders as a part; a library of mechanisms to start
  from; unit presets; and export to Excel and a printed report.
- It lacks what mekasim has: a model as readable text with named parameters, gears,
  belts and cams, real outlines from drawings, parts to cut or print, a 3D view,
  checks, and what mekafit does with parts that touch.
- It allows editing only at the start of the cycle, so that no plot is shown of a
  half-solved mechanism.

## Develop

```
pnpm build       # production build of both apps, into apps/sim/dist and apps/fit/dist
pnpm test        # unit tests
pnpm typecheck
pnpm lint        # Biome; `pnpm format` applies fixes
pnpm schema      # regenerate the JSON Schema after changing the format
```

The core package runs as TypeScript directly, without a build step, so its source
is limited to syntax Node can strip (no `enum`, no parameter properties).

```
packages/core/src
  schema/     document format (Zod), YAML loading
  expr/       expression parser, units and dimensions
  compile/    document -> solver model
  solver/     constraints, position/velocity/acceleration, degrees of freedom
  analysis/   motion cycle, measures, checks and plots, CSV, parameter sweeps
  fabricate/  parts as flat pieces, sheet layout, DXF
  geometry/   outlines: plates, shapes of lines and arcs, path text
  drawing/    DXF drawings: reading, joining into outlines, shapes from them
  edit/       changes to model text in place, model operations
  simulate.ts the whole pipeline in one call
  cli.ts      command-line runner
packages/ui/src
  theme.ts    colours and fonts (with theme.css), light and dark
  names.ts    names from the model as words
  editor/     YAML source editor, renaming by editing
  plot/       chart geometry and drawing
  io/         share links, downloads
  drawings/   the Geometry tab: what a drawing holds, attaching and replacing
  *.tsx       parts of the interface that hold no model: folds, dividers, choices, tabs
  scene.ts    what is drawn of a model: outlines, pins, traces, the pose at a step
  sheet/      a flat SVG drawing sheet: pan, zoom, grid, names, dimensions
packages/fit/src   mekafit's side of the pipeline (see docs/mekafit/DESIGN.md)
  schema.ts, compile.ts   what mekafit adds to the format, read and checked
  geometry/   the places where two shapes are about to touch
  solver/     the contact step: one-sided rows, a small quadratic program, springs,
              the stages of a move, forces
  measures.ts force, torque, latched, final, first
  simulate.ts the whole pipeline in one call, as core's
apps/fit/src       mekafit: the sheet, the Run panel, the Contacts and the Springs
                   and locks folds
apps/sim/src
  store.ts    model text, solved result, playback state
  viewport/   the drawing: three.js rendering, labels,
              hit-testing, drawing tools
  panels/     header, inspector, parameters, measures, checks, plots, messages, timeline
  io/         3MF, STL
```

mekasim deploys to Netlify from `netlify.toml` as a static site; mekafit has its own
`apps/fit/netlify.toml` for a second site.
