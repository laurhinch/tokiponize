// SSA top-1000 girl and boy names for a year, tagged with the origin
// languages Wikidata records, and tokiponized. Writes
// eval/data/popular-names.csv and eval/data/popular-names.jsonl.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { tokiponize } from "../dist/index.js";

const UA = "tokiponize-eval/1.0 (https://github.com/laurhinch/tokiponize)";
const SPARQL = "https://query.wikidata.org/sparql";
// the official zip is behind a bot block, so read the mirror
const SSA_MIRROR =
  "https://raw.githubusercontent.com/aruljohn/popular-baby-names/master";

const CANDIDATES = 4;
const BATCH = 150;
const MAX_ORIGINS = 6;
const MAX_NATIVES = 3;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const year = flag("year", "2025");
const cutoff = Number(flag("limit", "1000"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, attempts = 4) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
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
  throw last ?? new Error("gave up on wdqs");
}

async function fetchRanked(sex) {
  const url = `${SSA_MIRROR}/${year}/${sex}_names_${year}.json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  const names = data.names ?? [];
  if (names.length < 100) throw new Error(`only ${names.length} ${sex} names`);
  return names.slice(0, cutoff);
}

function collect(girls, boys) {
  const rows = new Map();
  const note = (name, key, rank) => {
    const row = rows.get(name) ?? { name, girlRank: "", boyRank: "" };
    row[key] = rank;
    rows.set(name, row);
  };
  girls.forEach((n, i) => note(n, "girlRank", i + 1));
  boys.forEach((n, i) => note(n, "boyRank", i + 1));
  for (const row of rows.values()) {
    row.sex = row.girlRank && row.boyRank ? "both" : row.girlRank ? "girl" : "boy";
    row.bestRank = Math.min(row.girlRank || Infinity, row.boyRank || Infinity);
  }
  return [...rows.values()].sort(
    (a, b) => a.bestRank - b.bestRank || a.name.localeCompare(b.name),
  );
}

const ORIGIN_QUERY = (labels) => `
SELECT ?label ?qid ?langName ?native ?links WHERE {
  VALUES ?label { ${labels} }
  ?item rdfs:label ?label ;
        wdt:P31/wdt:P279* wd:Q202444 ;
        wikibase:sitelinks ?links .
  BIND(STRAFTER(STR(?item), "entity/") AS ?qid)
  OPTIONAL { ?item wdt:P407 ?lang . ?lang rdfs:label ?langName . FILTER(LANG(?langName) = "en") }
  OPTIONAL { ?item wdt:P1705 ?native . }
}`;

// one label can match several name items (Maya is Hindi, Japanese and
// Seediq), so rank each origin by the sitelinks of the item asserting it
async function fetchOrigins(names) {
  const found = new Map();
  const skipped = [];
  let done = 0;

  const absorb = (rows) => {
    for (const row of rows) {
      const label = row.label.value;
      const links = Number(row.links?.value ?? 0);
      const entry =
        found.get(label) ?? { origins: new Map(), natives: new Set(), qid: "", links: -1 };
      if (links > entry.links) {
        entry.links = links;
        entry.qid = row.qid?.value ?? "";
      }
      // P407 mul says nothing about how the name reads
      const lang = row.langName?.value;
      if (lang && lang !== "multiple languages") {
        entry.origins.set(lang, Math.max(entry.origins.get(lang) ?? 0, links));
      }
      // a Latin native label just repeats the name
      const native = row.native?.value;
      if (native && /[^\x00-\x7F]/.test(native)) entry.natives.add(native);
      found.set(label, entry);
    }
  };

  // a label matching hundreds of items can time the query out, so halve and
  // retry instead of losing the run
  const run = async (batch) => {
    const labels = batch
      .map((n) => `"${n.replace(/["\\]/g, "\\$&")}"@en`)
      .join(" ");
    try {
      absorb(await sparql(ORIGIN_QUERY(labels)));
      done += batch.length;
    } catch (err) {
      if (batch.length === 1) {
        skipped.push(batch[0]);
        done += 1;
        process.stderr.write(`\nskipped ${batch[0]}: ${err.message}\n`);
        return;
      }
      const half = Math.ceil(batch.length / 2);
      process.stderr.write(`\nsplitting ${batch.length} after: ${err.message}\n`);
      await run(batch.slice(0, half));
      await run(batch.slice(half));
    }
  };

  for (let i = 0; i < names.length; i += BATCH) {
    await run(names.slice(i, i + BATCH));
    process.stderr.write(`\rorigins: ${done}/${names.length}`);
    await sleep(200);
  }
  process.stderr.write("\n");
  if (skipped.length) console.log(`no origin lookup for: ${skipped.join(", ")}`);
  return found;
}

function readings(name) {
  const rules = tokiponize(name, { limit: CANDIDATES });
  const exp = tokiponize(name, { limit: CANDIDATES, experimental: true });
  return { rules, exp };
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

const HEADER = [
  "name",
  "sex",
  "girl_rank",
  "boy_rank",
  "origin",
  "native",
  "wikidata",
  "rules_best",
  "rules_alts",
  "experimental_best",
  "experimental_alts",
  "community",
  "notes",
];

const [girls, boys] = await Promise.all([
  fetchRanked("girl"),
  fetchRanked("boy"),
]);
const rows = collect(girls, boys);
console.log(`${rows.length} distinct names from the ${year} SSA lists`);

const origins = await fetchOrigins(rows.map((r) => r.name));

const csv = [csvRow(HEADER)];
const jsonl = [];
let tagged = 0;

for (const row of rows) {
  const hit = origins.get(row.name);
  const origin = hit
    ? [...hit.origins.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_ORIGINS)
        .map(([lang]) => lang)
    : [];
  const native = hit ? [...hit.natives].slice(0, MAX_NATIVES) : [];
  if (origin.length) tagged++;

  const { rules, exp } = readings(row.name);
  csv.push(
    csvRow([
      row.name,
      row.sex,
      row.girlRank,
      row.boyRank,
      origin.join("; "),
      native.join("; "),
      hit?.qid ?? "",
      rules[0]?.name ?? "",
      rules.slice(1).map((c) => c.name).join("; "),
      exp[0]?.name ?? "",
      exp.slice(1).map((c) => c.name).join("; "),
      "",
      "",
    ]),
  );
  jsonl.push(
    JSON.stringify({
      name: row.name,
      sex: row.sex,
      girlRank: row.girlRank || null,
      boyRank: row.boyRank || null,
      origin,
      native,
      wikidata: hit?.qid ?? null,
      rules,
      experimental: exp,
    }),
  );
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(outDir, { recursive: true });
const csvFile = join(outDir, "popular-names.csv");
const jsonlFile = join(outDir, "popular-names.jsonl");
// BOM so Excel opens the non-Latin native spellings as UTF-8
writeFileSync(csvFile, "\uFEFF" + csv.join("\n") + "\n");
writeFileSync(jsonlFile, jsonl.join("\n") + "\n");

console.log(`origin tagged: ${tagged}/${rows.length}`);
console.log(`wrote ${csvFile}`);
console.log(`wrote ${jsonlFile}`);
