// Prune wikidata-tok.jsonl: drop entities with no capitalized proper name
// or an invalid attested form, drop labels our scripts can't pronounce,
// and strip lowercase head nouns from the tok field.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toPhonemes, isValidName } from "../dist/index.js";
import { capWords, splitWords, usableLabel } from "./lib.mjs";

const file = join(dirname(fileURLToPath(import.meta.url)), "data", "wikidata-tok.jsonl");
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const dropped = { noName: 0, invalidAttested: 0, labels: 0, noLabels: 0 };
const kept = [];

for (const row of rows) {
  const att = capWords(row.tok);
  if (!att.length) {
    dropped.noName++;
    continue;
  }
  if (!att.every((w) => isValidName(w))) {
    dropped.invalidAttested++;
    continue;
  }
  const labels = {};
  for (const [lang, label] of Object.entries(row.labels)) {
    const readable = usableLabel(label) &&
      splitWords(label).every((w) => toPhonemes(w).length > 0);
    if (readable) labels[lang] = label;
    else dropped.labels++;
  }
  if (!Object.keys(labels).length) {
    dropped.noLabels++;
    continue;
  }
  kept.push({ ...row, tok: att.join(" "), labels });
}

writeFileSync(file, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`kept ${kept.length} of ${rows.length} entities`);
console.log(dropped);
