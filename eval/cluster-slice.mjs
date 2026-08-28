// Exact-match rate on sources whose phoneme string holds a consonant
// cluster, against sources without one. Clusters are where the engine has
// to choose between losing a consonant and gaining a syllable, so this
// slice answers whether that choice is being made the way the community
// makes it. Numbers from this script are logged in tuning-log.md.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toPhonemes, tokiponize } from "../dist/index.js";
import { alignPairs, nameWords, usableLabel } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, "data", "wikidata-tok.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const CLUSTER = /[ptksmnljw]{2}/;
const slice = {
  cluster: { n: 0, top1: 0, top8: 0 },
  plain: { n: 0, top1: 0, top8: 0 },
};
const misses = [];

for (const row of rows) {
  // one English label per entity, so a name is counted once
  for (const [lang, label] of Object.entries(row.labels)) {
    if (!lang.startsWith("en") || !usableLabel(label)) continue;
    const attested = nameWords(row.tok);
    if (attested.length !== 1) continue;
    const pairs = alignPairs(label, attested);
    if (!pairs || pairs.length !== 1) continue;
    const [source, want] = pairs[0];
    const names = tokiponize(source, { limit: 8 }).map((c) => c.name.toLowerCase());
    if (!names.length) break;
    const bucket = CLUSTER.test(toPhonemes(source)) ? slice.cluster : slice.plain;
    bucket.n++;
    if (names[0] === want.toLowerCase()) bucket.top1++;
    if (names.includes(want.toLowerCase())) bucket.top8++;
    else if (bucket === slice.cluster && misses.length < 25) {
      misses.push(`${source} (${toPhonemes(source)}) -> ours "${names[0]}", attested "${want}"`);
    }
    break;
  }
}

console.log("source        n     top1    top8");
for (const [name, b] of Object.entries(slice)) {
  console.log(
    name.padEnd(14) + String(b.n).padStart(4) +
      (100 * b.top1 / b.n).toFixed(1).padStart(8) + "%" +
      (100 * b.top8 / b.n).toFixed(1).padStart(7) + "%",
  );
}
console.log("\ncluster sources we cannot reach at all:");
for (const m of misses) console.log("  " + m);
