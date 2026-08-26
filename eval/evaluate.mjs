// Score the tokiponizer against attested Wikidata tokiponizations.
// Writes eval/data/report.json and prints the summary.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRows } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, "data", "wikidata-tok.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const { summary, notTop1, unreachable } = evaluateRows(rows, { samples: true });

writeFileSync(
  join(here, "data", "report.json"),
  JSON.stringify({ summary, notTop1, unreachable }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
console.log("\nreachable but not top-1 (ranking/penalty signal):");
for (const m of notTop1.slice(0, 15)) {
  console.log(`  ${m.source} -> "${m.tok}" at rank ${m.rank}, our #1 "${m.ours}"`);
}
console.log("\nunreachable from any label (rule gaps or endonym gaps):");
for (const m of unreachable.slice(0, 15)) {
  console.log(`  ${m.closest} -> "${m.tok}", ours "${m.ours}"`);
}
