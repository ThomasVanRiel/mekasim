# Backlog

Ideas and known gaps that are not scheduled in a phase of [PLAN.md](PLAN.md).
Nothing here is committed to; it is a place to keep things from being forgotten.

## Phases still to build

The two phases of [PLAN.md](PLAN.md) that are not built. They wait until the
backlog below has been worked through.

### Forces (phase 5)

Give links a mass, then compute over a cycle what the motion demands: the loads in
the joints, the torque the motor must deliver, and the shaking force and moment on
the frame. Springs come in as applied forces. It builds on the constraint equations
already in the solver.

### Spatial mechanisms (phase 6)

Ball joints, universal joints and linkages that leave the plane, with bodies
positioned in three dimensions. The largest piece left: a new solver formulation,
and a 3D view that can be drawn and selected in. It is built in mekasim only;
mekafit and mekacarve stay in the plane, since their gaps, sheet and cutting all
work on outlines.

The solve loop stays as it is: every joint already goes through one `Constraint`
interface, and the least-squares step copes with free and redundant motion. The
steps, each leaving the example baseline unchanged until a model uses something new:

1. **The solver stops taking every coordinate for a planar body's.** Planar bodies
   keep the front of `q`, three coordinates each, so everything that reads
   `3 * body` stays right. Spatial bodies follow in blocks of their own. The
   Jacobian's width, the mobility count, dragging and the jerk step go by the
   whole of `q` and by a layout of the blocks, not by the number of bodies.
   In `packages/core/src/solver/`: `jacobian` in `solve.ts` takes its width from
   `q0.length`; `SolverModel` says planar bodies come first, and a `blocks(model)`
   gives each body's `{ id, at, size }` for whatever needs the layout; the fastest
   turn in `solveJerk` and the turn limit in `drag.ts` look at planar angles only;
   `mobility.ts` counts `q.length` coordinates and finds free bodies through
   `blocks`. Nothing else reads past the planar bodies, so compile, measures,
   `packages/fit`, `packages/ui` and `apps/sim` are left as they are. A test builds
   a solver model by hand with a few extra coordinates after the planar bodies, held
   by a stand-in constraint, and checks that the Jacobian, mobility, jerk and
   dragging still give the planar answers. The baseline must not move. This work is
   done in a worktree, `../mekasim-spatial` on the branch `spatial`, not on `main`.
2. **Spatial bodies and joints.** A spatial body is a position and a unit
   quaternion (Euler parameters, as in Haug and Nikravesh), seven coordinates and
   one equation that keeps the quaternion of unit length. Joints, with their
   equations: spherical 3, universal 4, revolute about an `axis` 5, cylindrical 4,
   prismatic 5, point on a plane 1, point on a line 2. Each Jacobian is checked
   against finite differences. Freedoms that move nothing, such as the coupler of
   an RSSR four-bar spinning about its own line, are found and named in the
   diagnostics rather than counted as degrees of freedom. Done when the RSSR
   four-bar solves through `pnpm solve`.
   Built in `packages/core/src/solver/spatial.ts`, with a driver that turns a hinge
   about its axis, and `idle` and `idleBodies` in `mobility.ts`. To get the RSSR
   through `pnpm solve`, some of step 4 came along: `spatial: true` on a body,
   points as `[x, y, z]`, a pose `{ at, axis, angle }`, `spherical` joints and an
   `axis` on `revolute`, all in mekasim's schema only (mekafit's stays planar).
   Bodies in space are kept apart from the planar ones (`compiled.spatial`,
   `compiled.spatialJoints`), so drawing, measures, layers and export do not see
   them yet. The example is `examples/spatial/rssr.mekasim.yaml`, outside the
   app's list and the baseline until the view can show it. The other joints are in
   the solver, with their tests, but not yet in the format.
3. **Planar groups placed in space.** A `planes:` section (an origin and a normal);
   a planar body may sit on a plane and keeps its three coordinates, mapped into
   the world where it meets a spatial body. Gears, belts and cams stay planar and
   must share one plane.
   Built: `planes:` with an optional `x` direction, `plane:` on a body, and joints in
   space that take bodies in the plane on any plane (the `Plane` of a `SpatialBody`
   in `spatial.ts`). Every joint in the plane, gears, belts and cams among them,
   works in its plane's own terms and needs all its bodies on that plane. Bodies on
   a plane other than the sheet, and their joints, are kept apart
   (`compiled.planeBodies`, `compiled.planeJoints`), so the drawing and measures do
   not see them yet. Components stay on the sheet.
4. **Format and measures.** Points may be `[x, y, z]` and joints take an `axis`;
   left out, they mean the plane as now, so `mekasim: 1` files stay valid (done for
   bodies in space, ball joints and hinges in step 2). Still to come: universal,
   cylindrical, prismatic, point-on-plane and point-on-line joints in the format;
   measures, traces and frames of bodies in space; `z(p)`, angles between axes, and
   a meaning (or another name) for `angle(body)` on a spatial body.
5. **The view.** Spatial bodies drawn as rods with ball and fork ends, picking in
   3D, sketching on a chosen plane with the 2D tools; truly spatial parts written
   in the source and the inspector first, a gizmo for placing points in 3D last.

## Ideas

### Plot in coordinates that suit the joint

A motion can be measured and plotted in a frame of the model (`frames:`), along
x and y or as a radius and an angle, also as seen from a moving body. What is
left:

- **Draw a frame on the sheet:** its origin and its two axes, moving with the
  mechanism, so that it can be seen where it is and how it is turned.
- **"Plot" buttons on joints:** the travel along the axis of a slider or pin-slot,
  and the radius and angle of a cam's follower as seen from the cam, with the
  frame they need made along with them.
- **A polar chart** alongside the line chart: the radius drawn against the angle
  gives the shape of a cam.
- **An angle that stays within one turn,** for a lift diagram read against the
  angle round the cam. `theta` runs on past a full turn, like `angle`.
- **Turning seen from a frame:** `angle`, `omega` and `alpha` of a body are always
  those over the sheet.

### Eccentrics

Think through how an eccentric should be modelled, drawn and made. Today it is a
crank like any other: a body with a point at the shaft and a point at the throw,
each with a pin. That solves correctly, but it is not what an eccentric is.

- A real eccentric is a disc fixed on the shaft, its centre off the shaft's centre
  by the throw, with the rod's eye running round the disc. The throw is usually
  smaller than the shaft is thick, so there is no room for a separate crank pin.
- As a crank with pins, the pins at the shaft and at the throw overlap once the
  throw is smaller than a pin. For now such pins are shrunk to fit, which keeps the
  drawing and the export consistent but cannot be built at full size.
- Several eccentrics on one shaft, as on a combine's sieve drive, sit side by side
  along the shaft, each with its own rod. Layers now keep the rods apart, but the
  shaft itself is not a part that runs through them.
- Questions to settle: whether an eccentric becomes a component of its own (shaft
  position, throw, phase, disc diameter), written as one entry for all throws on a
  shaft; how it is drawn (disc and ring instead of two pins); what is exported (a
  disc with an off-centre shaft hole, and a rod with a large eye and clearance);
  and how the shaft and its bearing appear.

### Drawings: what is not read or kept yet

A body can take its outline from a DXF drawing (`geometry:`). Left to do:

- **SVG drawings.**
- **Saving the drawings themselves.** A saved model keeps the outlines it took from
  its drawings, so it is complete, but the DXF files are not saved with it: they are
  kept in the browser, where a large one may not fit, and a model opened elsewhere
  shows its shapes without the layer table. A folder or `.zip` with both would do it.
- **Following a file** as it changes on disk, and picking an outline on the sheet
  to give it to a body.
- **True arcs in the parts' DXF.** Parts to make are exported with many-sided
  polygons for their arcs.

### A viewer to embed in other pages

A small React component that shows one mechanism moving, to use on a page of
another site, such as Thomas's own. No source, no drawing tools, no inspector.

Decided:

- **What it shows:** the animated mechanism and the model's plots. The page can
  name the plots it wants, or ask for none; left to itself the viewer shows all of
  the model's `plots:`.
- **Controls:** play and pause, a slider for the position in the cycle, and the
  playback speed, as in the app. A checkbox shows or hides the names of points and
  links.
- **The model is given as YAML,** the same text the app reads.
- **A React component,** drawn into the page itself, not an `<iframe>`.
- **A flat SVG drawing,** not Three.js: there is no 3D view in the viewer. The
  charts are plain SVG already.
- **A link to the full app** that opens exactly the YAML being shown, the way a
  share link does.
- **Colours can be given** by the page; left out, the viewer uses the app's own.

What it would take:

- Done: the description of the drawing (`scene.ts`: outlines, pins, traces and the
  pose at each step) and the charts (`plot/`) are in `packages/ui`, which needs only
  the core and React, not the app's store. The colours come from the theme there,
  and would still have to become something the page can pass in.
- Done, for mekafit: a flat SVG sheet (`packages/ui/src/sheet`) with pan, zoom, grid,
  names and dimensions, and a drawing of the description on it
  (`apps/fit/src/sheet/Drawing.tsx`), which would move to `packages/ui` for the
  viewer. Playback is a small piece of state inside the component.
- The viewer keeps nothing in the browser, so it never touches the model the
  visitor has open in the app.

The repository and the site will be public by the time this is built, so the
component can be published as a package like any other, and the link to the full
app gives nothing away.

Done so far:

- **Export links for 3D printing and laser cutting.** "Make" in the header; real
  dimensions in the model's `fabrication:` section.

## Open points on the export

- **An eccentric is made as a crank with small pins;** see "Eccentrics" under Ideas.
- **Pins that pass through other layers.** Layers keep plates from running into
  each other, but a pin joining a body on one layer to a body several layers away
  passes through the layers between, and nothing checks what is there.

- **Gears have no teeth.** A gear is not exported as a part; only the body it sits
  on is.
- **Layers are not spacers.** Links on different layers are exported as flat plates
  of one thickness; nothing is added to hold them apart.
- **The base plate** covers all fixed pivots in one piece, which for a long
  mechanism is a large plate. It can be deleted in the cutting program.
- **Parts are stacked in one column,** not nested to save material.
- **The STL holds all parts as one solid.** The 3MF keeps them apart, as named
  objects in one file; there is no file per part.
- **Outlines are polygons,** with 96 corners to a full turn, not true arcs.

## Known gaps

Left out of the phases built so far, noted as each was handed over.

- **Renaming** is done in the source, where editing a name where it is defined
  changes every use of it. There is no renaming from the drawing or the inspector.
  The pins a rod stands for (`rod_a`, `rod_b`) and the ground point of a crank are
  not followed when the rod or crank is renamed.
- **Drawing tools** place a slot's line on the ground only; a slot along a moving
  body is written in the source. A belt is made by drawing a gear and switching it
  in the inspector. A cam's follower still needs its own pin or slot.
- **A wheel or cam on the ground body** (a fixed sun gear, a fixed cam) works in the
  solver but is not drawn.
- **Gear teeth are not drawn,** only the pitch circle with marks on it. A belt is
  drawn as its two straight runs.
- **Cam followers never lift off.** Contact is kept even where a real follower
  would leave the cam.
- **3D view:** links are layered so that plates do not run into each other, but
  shafts and spacers are not modelled, and nothing can be selected or drawn in 3D.
- **Measured distances** are drawn on the sheet only where the measure is a plain
  `dist(a, b)`; a distance inside a larger expression is not, and neither are
  angles.
- **Point names** can overlap where points sit close together.
- **Removing a link** leaves measures and plots that mention it, which then show up
  as errors.
- **Recent models:** only the last model is kept in the browser; there is no list.
- **Tracing picture:** images only, no DXF; not kept across a reload.
- **Parameter comparison** is capped at five values and its results are not in the
  CSV export.
- **Bundle size:** the app is a single JavaScript file of about 2.1 MB (about
  630 kB compressed); it has not been split.
