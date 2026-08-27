// Score the tokiponizer against attested Wikidata tokiponizations.
// Writes eval/data/report.json and prints the summary.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRows, scriptBreakdown } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, "data", "wikidata-tok.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const { summary, notTop1, unreachable } = evaluateRows(rows, { samples: true });
const byScript = scriptBreakdown(rows);

writeFileSync(
  join(here, "data", "report.json"),
  JSON.stringify({ summary, byScript, notTop1, unreachable }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));

// counted only over labels that can reach the attested form, so a low
// score means we read that script badly, not that the language differs
console.log("\nhow well each script reads, where the label is the real source:");
console.log("script      labels  on source  ranked 1st   top4");
for (const [script, s] of Object.entries(byScript).sort((a, b) => a[1].ranked1st - b[1].ranked1st)) {
  console.log(
    script.padEnd(12) + String(s.labels).padStart(6) +
      String(s.onSource).padStart(11) + String(s.ranked1st).padStart(12) +
      String(s.top4).padStart(7),
  );
}
console.log("\nreachable but not top-1 (ranking/penalty signal):");
for (const m of notTop1.slice(0, 15)) {
  console.log(`  ${m.source} -> "${m.tok}" at rank ${m.rank}, our #1 "${m.ours}"`);
}
console.log("\nunreachable from any label (rule gaps or endonym gaps):");
for (const m of unreachable.slice(0, 15)) {
  console.log(`  ${m.closest} -> "${m.tok}", ours "${m.ours}"`);
}
