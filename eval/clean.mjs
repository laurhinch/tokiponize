// Prune wikidata-tok.jsonl: drop entities with no name or an invalid
// attested form, drop labels our scripts can't pronounce, strip the toki
// pona head nouns a name sits next to, and strip attested words no label
// could have produced.
//
// tokRaw keeps the harvested form, so a word we drop today because we
// misread its source comes back once the reading is fixed.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toPhonemes, isValidName } from "../dist/index.js";
import { nameWords, sourcedWords, splitWords, usableLabel } from "./lib.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "data");
const file = join(dir, "wikidata-tok.jsonl");
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (rows.length < 1000) {
  console.error(`only ${rows.length} rows, refusing to overwrite (bad harvest?)`);
  process.exit(1);
}

const dropped = { noName: 0, invalidAttested: 0, labels: 0, noLabels: 0 };
const trimmedWords = { qualifier: 0, entities: 0 };
const kept = [];
const rejected = [];

for (const row of rows) {
  const tokRaw = row.tokRaw ?? row.tok;
  const att = nameWords(tokRaw);
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

  // a word no label could have produced is a qualifier (Omi Nijon for Omi
  // Province) or a translation (Wikisoweli for Wikispecies), not a reading
  const sourced = sourcedWords({ labels }, att, toPhonemes);
  if (sourced.length < att.length) {
    trimmedWords.qualifier += att.length - sourced.length;
    trimmedWords.entities++;
    rejected.push({
      id: row.id,
      tokRaw: att.join(" "),
      unsourced: att.filter((w) => !sourced.includes(w)).join(" "),
      en: labels.en ?? Object.values(labels)[0],
    });
  }
  kept.push({ id: row.id, tok: sourced.join(" "), tokRaw: att.join(" "), labels });
}

writeFileSync(file, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(dir, "rejected.jsonl"), rejected.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`kept ${kept.length} of ${rows.length} entities`);
console.log(dropped);
console.log(`unsourced words stripped: ${trimmedWords.qualifier} across ${trimmedWords.entities} entities`);
console.log(`fully unsourced (tok now empty): ${kept.filter((r) => !r.tok).length}`);
