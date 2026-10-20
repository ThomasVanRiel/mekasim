/** A lever held up against a bar by a spring; the bar comes down 10 mm and goes back. */
export const LEVER = `mekafit: 1
meta:
  units: { length: mm, angle: deg }
bodies:
  ground:
    points: { O: [0, 0] }
  lever:
    points: { O: [0, 0] }
    shape: { path: "M 0 -5 H 100 V 5 H 0 Z" }
  bar:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 10 H 0 Z" }
joints:
  pin: { type: revolute, connect: [ground.O, lever.O] }
pose:
  bar: [75, 15, 0]
drivers:
  press:
    move: bar
    stages:
      - { to: [75, 5, 0], time: 1 }
      - { to: [75, 15, 0], time: 1 }
springs:
  up: { joint: pin, stiffness: 0.02 N*m/rad, rest: 30 deg }
contacts:
  rest: { between: [lever, bar] }
cycle: { steps: 20 }
`;

/**
 * A pusher shoves a loose block towards a wall at 100 mm. Pushed to 40 mm it stops
 * clear of the wall; pushed to 80 mm it squeezes the block against it and jams.
 */
export const PUSHED = `mekafit: 1
meta:
  units: { length: mm, angle: deg }
params:
  to: 40 mm
bodies:
  ground:
    points: { O: [0, 0] }
    shape: { path: "M 100 -20 H 110 V 40 H 100 Z" }
  pusher:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 10 V 20 H 0 Z" }
  block:
    points: { O: [0, 0] }
    shape: { path: "M 0 0 H 20 V 20 H 0 Z" }
pose:
  block: [30, 0, 0]
drivers:
  push:
    move: pusher
    stages:
      - { to: [to, 0, 0], time: 1 s }
contacts:
  push: { between: [pusher, block] }
  stop: { between: [block, ground] }
cycle: { steps: 40 }
checks:
  clear: min(gap(block, ground)) > 1 mm
studies:
  far:
    sample: grid
    vary:
      to: { from: 40 mm, to: 80 mm, steps: 2 }
`;
