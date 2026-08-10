// Run: tsx src/__tests__/compaction-thresholds-drag.test.ts
// The slider's drag-and-push logic must always produce a legal chain
// soft < snip < compact < force with ≥1% spacing inside [5,95], including at
// the track extremes where neighbours get pushed.

import { dragValues } from "../components/CompactionThresholdsSlider";

let passed = 0;
let failed = 0;

function ok(value: boolean, label: string) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

type Chain = [number, number, number, number];

function legal(v: Chain): boolean {
  return v[0] >= 5 && v[3] <= 95 && v[0] < v[1] && v[1] < v[2] && v[2] < v[3];
}

console.log("\ncompaction thresholds drag");

{
  const base: Chain = [50, 60, 80, 90];
  // Drag soft to the left extreme: it floors at 5; the chain stays legal.
  const out = dragValues(base, 0, 1);
  ok(legal(out), `soft to 1 stays legal: ${out.join(",")}`);
  ok(out[0] === 5, `soft reaches the floor: got ${out[0]}`);
  ok(out.join(",") === "5,60,80,90", `non-conflicting neighbours stay put: ${out.join(",")}`);
}
{
  // Drag force to the right extreme: it ceilings at 95; the chain stays legal.
  const out = dragValues([50, 60, 80, 90], 3, 200);
  ok(legal(out), `force to 200 stays legal: ${out.join(",")}`);
  ok(out[3] === 95, `force reaches the ceiling: got ${out[3]}`);
}
{
  // Drag compact past force: it clamps to the ceiling slot (94) and pushes
  // force to 95, keeping the chain legal.
  const out = dragValues([50, 60, 80, 90], 2, 200);
  ok(legal(out), `compact past force stays legal: ${out.join(",")}`);
  ok(out[2] === 94 && out[3] === 95, `compact clamped to 94, force pushed to 95: ${out.join(",")}`);
}
{
  // Drag snip far below soft: soft gets pushed down, chain stays legal.
  const out = dragValues([50, 60, 80, 90], 1, 1);
  ok(legal(out), `snip to 1 stays legal: ${out.join(",")}`);
  ok(out[0] === 5 && out[1] === 6, `soft pushed to 5, snip floors at 6: ${out.join(",")}`);
}
{
  // Every thumb at every extreme of a fresh chain stays legal (idempotence).
  for (let i = 0; i < 4; i += 1) {
    for (const t of [1, 5, 50, 95, 200]) {
      const out = dragValues([50, 60, 80, 90], i, t);
      ok(legal(out), `thumb ${i} to ${t}: ${out.join(",")}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
