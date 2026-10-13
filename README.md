# mekasim

Explore planar mechanisms: describe linkages, eccentrics and joints in a YAML file,
solve their exact motion and measure what they do.

There is a solver core with a command-line runner, and a browser app that shows a
model moving in 2D and 3D next to its source. Drawing tools are next; see
[docs/PLAN.md](docs/PLAN.md).

## Use

Requires Node 26 and pnpm 11.

```
pnpm install
pnpm dev         # the app, at http://localhost:5173
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
the links, and downloads them as flat pieces: a DXF to laser cut, an STL to print.
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

The model format is described in [docs/FORMAT.md](docs/FORMAT.md); start from one
of the files in [`examples/`](examples). Besides links and pins a model can have
gears, belts, cams and fixed-distance ties, and cranks and rods given by their
dimensions instead of point positions.

## Develop

```
pnpm build       # production build of the app, into apps/web/dist
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
  geometry/   outlines of plates
  edit/       changes to model text in place, model operations
  simulate.ts the whole pipeline in one call
  cli.ts      command-line runner
packages/ui/src
  theme.ts    colours and fonts (with theme.css), light and dark
  names.ts    names from the model as words
  plot/       chart geometry and drawing
  io/         share links, downloads
  *.tsx       parts of the interface that hold no model: folds, dividers, choices
  scene.ts    what is drawn of a model: outlines, pins, traces, the pose at a step
  sheet/      a flat SVG drawing sheet: pan, zoom, grid, names, dimensions
packages/fit/src   mekafit's side of the pipeline (see docs/mekafit)
apps/fit/src       mekafit, a second app for parts that touch (see docs/mekafit)
apps/web/src
  store.ts    model text, solved result, playback state
  editor/     YAML source editor, renaming by editing
  viewport/   the drawing: scene description, three.js rendering, labels,
              hit-testing, drawing tools
  panels/     header, inspector, parameters, measures, checks, plots, messages, timeline
  io/         STL
```

The app deploys to Netlify from `netlify.toml` as a static site.
