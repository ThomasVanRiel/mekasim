# Backlog

Ideas and known gaps that are not scheduled in a phase of [PLAN.md](PLAN.md).
Nothing here is committed to; it is a place to keep things from being forgotten.

## Ideas

### Export links for 3D printing and laser cutting

Export the links of a mechanism as STL (to print) or DXF (to cut), to build a real
prototype of what was drawn.

- DXF: the outline of each link with a hole at every pinned point, laid out flat
  side by side, in the model's length unit.
- STL: the same outline extruded to a thickness, holes included; one file per link
  or all links arranged on one plate.
- The app already computes each link's outline for the drawing, so the geometry is
  mostly there.
- What is missing is real dimensions. Link width, plate thickness and pin size on
  screen are picked from the size of the model to look right; they are not part of
  the model. Exporting needs them as actual values: link width, thickness, hole
  diameter, and a clearance for the fit of pin in hole. These would be new settings
  in the model file.
- Open points: whether ground gets a base plate with the fixed pivots on it; how
  layers map to spacers or standoffs so links clear each other; what to do with
  sliders and pin-slots, which need a slot rather than a hole.

## Known gaps

Left out of the phases built so far, noted as each was handed over.

- **Drawing tools:** sliders, welds, pin-slots, gears, belts, cams, ties, cranks and
  rods cannot be drawn, only written in the source. Links, points and joints cannot
  be renamed from the drawing.
- **Gears, belts, cams and ties cannot be selected** on the sheet, so they have no
  inspector; change them in the source.
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
