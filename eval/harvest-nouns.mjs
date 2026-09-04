// Countries, large cities and widely spoken languages from Wikidata, with the
// toki pona label the community already uses where there is one. Writes
// eval/data/proper-nouns.csv and eval/data/proper-nouns.jsonl.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { tokiponize } from "../dist/index.js";

const UA = "tokiponize-eval/1.0 (https://github.com/laurhinch/tokiponize)";
const SPARQL = "https://query.wikidata.org/sparql";
const CANDIDATES = 4;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const cityLimit = flag("cities", 120);
const langLimit = flag("languages", 80);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(SPARQL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query }),
      });
      if (res.ok) return (await res.json()).results.bindings;
      const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
      last = new Error(`HTTP ${res.status}: ${body}`);
      // only retry throttling and timeouts
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (err) {
      last = err;
    }
    await sleep(3000 * (attempt + 1));
  }
  throw last;
}

// a country and a city cannot share one query, the union times WDQS out
const QUERIES = {
  country: `
    SELECT ?item ?en ?tok ?sort WHERE {
      ?item wdt:P31 wd:Q6256 .
      FILTER NOT EXISTS { ?item wdt:P576 ?d }
      ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
      OPTIONAL { ?item rdfs:label ?tok . FILTER(LANG(?tok) = "tok") }
      OPTIONAL { ?item wdt:P1082 ?sort }
    }`,
  city: `
    SELECT ?item ?en ?tok ?sort WHERE {
      ?item wdt:P31 wd:Q1549591 ; wdt:P1082 ?sort .
      ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
      OPTIONAL { ?item rdfs:label ?tok . FILTER(LANG(?tok) = "tok") }
    }
    ORDER BY DESC(?sort)
    LIMIT ${cityLimit}`,
  language: `
    SELECT ?item ?en ?tok ?sort WHERE {
      ?item wdt:P31 wd:Q1288568 ; wdt:P1098 ?sort .
      ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
      OPTIONAL { ?item rdfs:label ?tok . FILTER(LANG(?tok) = "tok") }
    }
    ORDER BY DESC(?sort)
    LIMIT ${langLimit}`,
};

// Wikidata labels these with the official long form, and P1813 gives
// abbreviations rather than what anyone searches for
const RENAME = {
  Q148: "China",
  Q974: "DR Congo",
  Q971: "Congo",
  Q29999: "Netherlands",
  Q756617: "Denmark",
  Q702: "Micronesia",
};

// an attested label carries its head noun (ma Kanata, ma tomo Sane, toki
// Inli), and only the capitalised part is the name
const nameOf = (tok) =>
  tok
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .join(" ");

async function fetchKind(kind) {
  const rows = await sparql(QUERIES[kind]);
  const seen = new Map();
  for (const row of rows) {
    const qid = row.item.value.replace(/.*entity\//, "");
    const name = RENAME[qid] ?? row.en.value;
    if (!/^[\p{L}\p{M}' -]+$/u.test(name)) continue;
    const entry = seen.get(name) ?? { name, kind, attested: "", qid: "", sort: 0 };
    if (row.tok?.value) entry.attested = nameOf(row.tok.value);
    entry.qid ||= qid;
    entry.sort = Math.max(entry.sort, Number(row.sort?.value ?? 0));
    seen.set(name, entry);
  }
  const out = [...seen.values()].sort(
    (a, b) => b.sort - a.sort || a.name.localeCompare(b.name),
  );
  console.log(`${kind}: ${out.length}, ${out.filter((r) => r.attested).length} attested`);
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

const HEADER = [
  "name",
  "kind",
  "attested",
  "wikidata",
  "rules_best",
  "rules_alts",
  "experimental_best",
  "experimental_alts",
  "agrees",
  "community",
  "notes",
];

const collected = [];
for (const kind of ["country", "city", "language"]) {
  collected.push(...(await fetchKind(kind)));
  await sleep(300);
}

// a rename can land on a name another kind already has, and the entry
// carrying an attested reading is the one worth keeping
const byName = new Map();
for (const row of collected) {
  const held = byName.get(row.name);
  if (!held || (!held.attested && row.attested)) byName.set(row.name, row);
}
const rows = [...byName.values()];

const csv = [csvRow(HEADER)];
const jsonl = [];
let agreed = 0;
let attested = 0;

for (const row of rows) {
  const rules = tokiponize(row.name, { limit: CANDIDATES });
  const exp = tokiponize(row.name, { limit: CANDIDATES, experimental: true });
  // whether the engine already gets the reading the community settled on
  const agrees = row.attested
    ? rules.some((c) => c.name.toLowerCase() === row.attested.toLowerCase())
      ? "top4"
      : "no"
    : "";
  if (row.attested) attested++;
  if (agrees === "top4") agreed++;

  csv.push(
    csvRow([
      row.name,
      row.kind,
      row.attested,
      row.qid,
      rules[0]?.name ?? "",
      rules.slice(1).map((c) => c.name).join("; "),
      exp[0]?.name ?? "",
      exp.slice(1).map((c) => c.name).join("; "),
      agrees,
      "",
      "",
    ]),
  );
  jsonl.push(
    JSON.stringify({
      name: row.name,
      kind: row.kind,
      attested: row.attested || null,
      wikidata: row.qid,
      agrees: agrees || null,
      rules,
      experimental: exp,
    }),
  );
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(outDir, { recursive: true });
const csvFile = join(outDir, "proper-nouns.csv");
const jsonlFile = join(outDir, "proper-nouns.jsonl");
// BOM so Excel opens this as UTF-8
writeFileSync(csvFile, "﻿" + csv.join("\n") + "\n");
writeFileSync(jsonlFile, jsonl.join("\n") + "\n");

console.log(`${rows.length} nouns, ${attested} attested, ${agreed} already in our top 4`);
console.log(`wrote ${csvFile}`);
console.log(`wrote ${jsonlFile}`);
