// Harvest Wikidata entities with a toki pona label (via CirrusSearch
// haslabel:tok) plus their labels in common source languages.
// Writes eval/data/wikidata-tok.jsonl.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://www.wikidata.org/w/api.php";
const UA = "tokiponize-eval/1.0 (https://github.com/laurhinch/tokiponize)";

const LANGS = [
  "en", "mul", "de", "fr", "es", "it", "pt", "nl", "pl", "cs", "sv", "fi",
  "tr", "eo", "la", "id", "vi", "ru", "uk", "el", "ja", "ko", "zh", "ar",
  "fa", "he", "hi",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
    } catch (err) {
      if (attempt === 4) throw err;
    }
    await sleep(1000 * (attempt + 1));
  }
}

async function collectIds() {
  const ids = [];
  let offset = 0;
  for (;;) {
    const data = await api({
      action: "query",
      list: "search",
      srsearch: "haslabel:tok",
      srnamespace: "0",
      srlimit: "50",
      sroffset: String(offset),
      srprop: "",
    });
    const hits = data.query?.search ?? [];
    for (const hit of hits) ids.push(hit.title);
    process.stderr.write(`\rids: ${ids.length}`);
    if (!data.continue) break;
    offset = data.continue.sroffset;
    await sleep(100);
  }
  process.stderr.write("\n");
  return ids;
}

async function fetchLabels(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await api({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels",
      languages: ["tok", ...LANGS].join("|"),
    });
    for (const [id, ent] of Object.entries(data.entities ?? {})) {
      const tok = ent.labels?.tok?.value;
      if (!tok) continue;
      const labels = {};
      for (const lang of LANGS) {
        const v = ent.labels?.[lang]?.value;
        if (v) labels[lang] = v;
      }
      rows.push({ id, tok, labels });
    }
    process.stderr.write(`\rlabels: ${Math.min(i + 50, ids.length)}/${ids.length}`);
    await sleep(100);
  }
  process.stderr.write("\n");
  return rows;
}

const ids = await collectIds();
const rows = await fetchLabels(ids);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "wikidata-tok.jsonl");
writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} entities to ${outFile}`);
