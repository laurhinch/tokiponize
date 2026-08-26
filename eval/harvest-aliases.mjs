// Merge aliases into wikidata-tok.jsonl. Kanji labels carry no phonetics
// but the reading often exists as a kana alias (にほん), and en/eo aliases
// often carry romanized endonyms (Nippon, Hanguk).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://www.wikidata.org/w/api.php";
const UA = "tokiponize-eval/1.0 (https://github.com/laurhinch/tokiponize)";
const KANA_ONLY = /^[぀-ヿー・\s]+$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const data = await res.json();
        if (!data.error) return data;
        process.stderr.write(`\napi error: ${data.error.code}, retrying\n`);
      } else if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (attempt === 5) throw err;
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`gave up on ${url}`);
}

const file = join(dirname(fileURLToPath(import.meta.url)), "data", "wikidata-tok.jsonl");
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(rows.map((r) => [r.id, r]));
const ids = [...byId.keys()];

const ALIAS_LANGS = ["ja", "en", "eo", "de", "ru", "tr", "id", "fi", "hu"];
const WORD = /^[\p{L}\s'-]+$/u;

let added = 0;
for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const data = await api({
    action: "wbgetentities",
    ids: batch.join("|"),
    props: "aliases",
    languages: ALIAS_LANGS.join("|"),
  });
  for (const [id, ent] of Object.entries(data.entities ?? {})) {
    const row = byId.get(id);
    for (const lang of ALIAS_LANGS) {
      const ok = (v) => lang === "ja" ? KANA_ONLY.test(v) : WORD.test(v);
      const aliases = (ent.aliases?.[lang] ?? [])
        .map((a) => a.value)
        .filter(ok);
      for (const [k, v] of [...new Set(aliases)].slice(0, 3).entries()) {
        row.labels[`${lang}-alias-${k}`] = v;
        added++;
      }
    }
  }
  process.stderr.write(`\r${Math.min(i + 50, ids.length)}/${ids.length}`);
  await sleep(100);
}
process.stderr.write("\n");

writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`added ${added} kana aliases`);
