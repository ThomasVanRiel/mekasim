// Writes what every example solves to, for the test that guards mekasim's numbers.
// Run it only when an example or the solver is changed on purpose, and read the diff.
import { writeFileSync } from "node:fs";
import { BASELINE, solveExamples } from "../test/baseline.ts";

writeFileSync(BASELINE, `${JSON.stringify(solveExamples(), null, 1)}\n`);
console.log(`Wrote ${BASELINE.pathname}`);
