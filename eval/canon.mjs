// Score the engine against eval/data/canon.csv, hand-derived names with the
// reasoning in the notes column. These aren't community conventions, so a
// miss is a rule gap.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toPhonemes, tokiponize } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, "data", "canon.csv"), "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const a = line.indexOf(",");
    const b = line.indexOf(",", a + 1);
    return {
      src: line.slice(0, a),
      want: line.slice(a + 1, b),
      note: line.slice(b + 1),
    };
  });

const LIMIT = 8;
const experimental = process.argv.includes("-x");
const buckets = { top1: [], top4: [], top8: [], miss: [] };

for (const row of rows) {
  const cands = tokiponize(row.src, { limit: LIMIT, experimental });
  const rank = cands.findIndex(
    (c) => c.name.toLowerCase() === row.want.toLowerCase(),
  );
  const hit = {
    ...row,
    rank,
    ours: cands[0]?.name ?? "",
    ph: toPhonemes(row.src),
  };
  if (rank === 0) buckets.top1.push(hit);
  else if (rank > 0 && rank < 4) buckets.top4.push(hit);
  else if (rank > 0) buckets.top8.push(hit);
  else buckets.miss.push(hit);
}

const n = rows.length;
const pct = (k) => `${((100 * k) / n).toFixed(1)}%`;
console.log(`canon.csv: ${n} names${experimental ? " (experimental)" : ""}`);
console.log(`  rank 1        ${String(buckets.top1.length).padStart(4)}  ${pct(buckets.top1.length)}`);
console.log(`  rank 2 to 4   ${String(buckets.top4.length).padStart(4)}  ${pct(buckets.top4.length)}`);
console.log(`  rank 5 to 8   ${String(buckets.top8.length).padStart(4)}  ${pct(buckets.top8.length)}`);
console.log(`  not in top 8  ${String(buckets.miss.length).padStart(4)}  ${pct(buckets.miss.length)}`);

if (process.argv.includes("--quiet")) process.exit(0);

for (const [label, list] of [
  ["not reachable in top 8", buckets.miss],
  ["reachable but not first", [...buckets.top4, ...buckets.top8]],
]) {
  console.log(`\n=== ${label} (${list.length}) ===`);
  for (const h of list) {
    const at = h.rank > 0 ? ` at ${h.rank}` : "";
    console.log(
      `  ${h.src.padEnd(14)} want ${h.want.padEnd(12)} ours ${h.ours.padEnd(12)}${at}`,
    );
    console.log(`  ${"".padEnd(14)} read as /${h.ph}/  ${h.note}`);
  }
}
