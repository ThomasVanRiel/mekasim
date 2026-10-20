# mekacarve — plan

mekacarve shapes a part by running its mechanism. It takes a mekafit model and one
of its studies, runs the study, finds where the parts get in each other's way, cuts
a little away there, and runs it again, until the study stops getting better. What
comes out is an outline for the part, as a DXF and as the `path` of its shape.

It answers "what shape lets this work?", where mekafit answers "does this shape
work?". "mekacarve" is a working name.

## Where it stands (2026-10-20)

**Step 1 is built** (§4): each sample of a mekafit run keeps where its parts touch,
on each part in its own frame, with the force there (`touches` beside `loads`), and
a jam's rows say where they are. Nothing draws them yet.

**Next is step 2**, gathering them over a study onto each part.

`examples/fit/coupler-pull.mekafit.yaml` is the model it is meant for first: the
coupler trial with a pull after the coupling, and a check that it holds.

## 1. What it does

```
outline ──► grid of cells, in the part's own frame ──► run the study
   ▲                                                          │
   │                                     where it touched, and how hard, in each run
   │                                                          │
outline ◄── rounded to the cutter ◄── cut a little where it was in the way ◄─┘
(lines and arcs)
```

Each pass runs the whole study, in worker threads as `fit:study` does. Every place
two parts touch is kept in each part's own frame with the force there, from every
run, the runs that failed counting more. Cells that are touched in failing runs
and carry nothing in passing ones are in the way, and are cut, a thin layer at a
time. The rest is smoothed to the smallest inside radius the part can be made
with, and turned back into lines and arcs for the next pass.

A part used more than once, as the two knuckles of a coupler are, is carved once:
what touches either copy goes onto the same grid.

## 2. What it may not do

A carver does what its checks ask, and anything not written as a check it is free
to break. So it is held in three ways.

**Where it may cut.** Each carved part has a region drawn where it may lose
material, a layer of its drawing. Nothing outside it is cut, so what was forgotten
stays. A second region, also drawn, is kept whatever happens: the pin and its hole,
the wall round them, the root of a hook. The drawings do not show what the model
only describes, such as a sprung pin, so that is drawn into the kept region.

**What the motion must still do.** The model's checks are the requirements, and a
pass is judged by them all. Writing them is the first work on a new part: what
it must do, not only what it must not run into. The coupler's are that it comes
home, locks, never runs through, and holds when pulled; uncoupling comes when a pin
can be let out (§5).

**How a cut is taken.** The cells in the way are grouped into separate places, and
the cut at each is tried on its own, each as a study of its own, side by side. A
cut is kept only if no run that met every check before fails one after it. If more
fail, it is put back and that place is cut half as deep next time. Cells that carry
force in runs that pass are not cut: a face that does its work keeps itself. Every
pass is kept with how many runs met each check, so any pass can be opened in
mekafit and looked at.

## 3. How it is described

A file of its own beside the model, so that mekafit's format does not change for
it:

```yaml
mekacarve: 1
model: coupler-pull.mekafit.yaml
study: coupling
parts:
  knuckle:                                  # a drawing of the model
    may: { layer: carve }
    keep: { layer: keep }
    radius: 1 mm                            # smallest inside radius
    depth: 0.3 mm                           # most cut in one pass
    cell: 0.1 mm
passes: 20
```

The checks it judges by are the model's own; `checks: [home, locked, holds]` would
choose some of them, as a study can.

## 4. Steps

Each step is committed on its own once lint, typecheck, tests and build pass.

1. **Where parts touch** (in `packages/fit`). Each sample keeps the places its
   contacts touch, in each body's own frame, with the force at each. A jam says
   where it is. Useful in mekafit itself: it can be drawn on the sheet.
2. **Where a study touches.** All the places from all of a study's runs gathered
   onto each shaped body, those of failing runs apart from those of passing ones;
   from the command line, as a picture of each part.
3. **Outline to grid and back.** A shape made into cells, and cells made back into
   lines and arcs, rounded to a radius. A round trip of the coupler's knuckle must
   come back within a cell of where it was.
4. **One pass** from the command line: run, gather, cut, write the new outline.
5. **The loop**, with cuts tried one by one, kept only where no run gets worse,
   and the regions that may and may not be cut.
6. **In the app.** Where it goes, its own app or a tab of mekafit, is decided once
   the loop works.

## 5. Open

- Letting a lock out from a stage, so that uncoupling can be a requirement. This is
  mekafit's format, and asked of Thomas before it is built.
- A cart free sideways under a pull with nothing holding it jams at once, even at
  2 N, and a pull of 30 N or more makes a run take minutes. Both are the contact
  step's, and both limit what the coupler can be asked to hold.
- Where the grid and outline code belongs: `packages/core`, if mekasim would use
  it, or with the carver.
- Carving only removes. Faces that must be moved, not only cut back, are left to a
  later search over a few dimensions of the part.
