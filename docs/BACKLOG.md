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
and a 3D view that can be drawn and selected in.

## Ideas

### Plot in coordinates that suit the joint

Positions are plotted as x and y on the sheet. For some joints other coordinates
say more.

- **Slider and pin-slot:** the pin can only move along its axis, so one number
  tells it all: the travel along the axis. Two curves in x and y hide that,
  and for a sloping axis neither of them is the travel. Plot the travel, and its
  speed and acceleration, as single curves.
- **Cam:** seen from the cam, the follower is at an angle round the cam and a
  distance from its centre. Plotting that distance against the cam angle gives the
  lift diagram as it really runs; drawn in polar form it gives the shape of the cam.
- What it would take: measure functions for these (for example the travel of a
  slider joint, and the radius and angle of a cam's follower), "Plot" buttons on
  those joints once they can be selected, and a polar chart alongside the line
  chart.
- A more general form of the same idea: the position of a point as seen from
  another body, not only from the ground.

Done so far:

- **Export links for 3D printing and laser cutting.** "Parts to make" in the side
  panel; real dimensions in the model's `fabrication:` section.

## Open points on the export

- **Gears have no teeth.** A gear is not exported as a part; only the body it sits
  on is.
- **Layers are not spacers.** Links on different layers are exported as flat plates
  of one thickness; nothing is added to hold them apart.
- **The base plate** covers all fixed pivots in one piece, which for a long
  mechanism is a large plate. It can be deleted in the cutting program.
- **Parts are stacked in one column,** not nested to save material.
- **One STL holds all parts** on one bed; there is no file per part.
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
- **3D view:** links are layered automatically, but shafts, spacers and the depth
  of pins are not modelled, and nothing can be selected or drawn in 3D.
- **Measured distances** are not drawn on the sheet as dimension lines; they only
  appear in the measures panel.
- **Point names** can overlap where points sit close together.
- **Removing a link** leaves measures and plots that mention it, which then show up
  as errors.
- **Recent models:** only the last model is kept in the browser; there is no list.
- **Tracing picture:** images only, no DXF; not kept across a reload.
- **Parameter comparison** is capped at five values and its results are not in the
  CSV export.
- **Bundle size:** the app is a single JavaScript file of about 1.9 MB (about
  550 kB compressed); it has not been split.
