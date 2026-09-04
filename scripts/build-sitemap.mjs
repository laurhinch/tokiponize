// sitemap.xml for the Pages site: the homepage, then a ?nimi= URL per proper
// noun from eval/data/proper-nouns.csv and per popular given name from
// eval/data/popular-names.csv.
//
// Usage: node scripts/build-sitemap.mjs _site [--names 300]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://nimi.toki.li";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--")) ?? "_site";
const namesAt = args.indexOf("--names");
const nameLimit = namesAt === -1 ? 300 : Number(args[namesAt + 1]);

const xml = (s) =>
  s.replace(/[<>&'"]/g, (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", "'": "apos", '"': "quot" }[c]};`);

function parse(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { cells.push(cell); cell = ""; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

// both harvests sort most-known first
function rows(file) {
  const path = join(root, "eval", "data", file);
  if (!existsSync(path)) {
    console.warn(`no ${path}, skipping it`);
    return [];
  }
  const lines = readFileSync(path, "utf8").replace(/^﻿/, "").trimEnd().split("\n");
  const head = parse(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parse(l).map((c, i) => [head[i], c])));
}

const today = new Date().toISOString().slice(0, 10);
const urls = [
  `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
];

// a country and a given name can be the same word, and Jordan only needs one
const seen = new Set();
const add = (name, priority) => {
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  const loc = `${SITE}/?nimi=${encodeURIComponent(name)}`;
  urls.push(`  <url>\n    <loc>${xml(loc)}</loc>\n    <priority>${priority}</priority>\n  </url>`);
};

// endonym lookup is out of scope, so where the harvest found a settled
// reading we do not produce, that page would rank on the wrong answer
const all = rows("proper-nouns.csv");
const nouns = all.filter((r) => r.agrees !== "no");
const names = rows("popular-names.csv").slice(0, nameLimit);
for (const r of nouns) add(r.name, "0.7");
for (const r of names) add(r.name, "0.6");
console.log(`proper nouns: ${nouns.length} of ${all.length}, dropped ${all.length - nouns.length} we contradict`);

const out = join(outDir, "sitemap.xml");
writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`,
);
console.log(`wrote ${out}: ${urls.length} urls`);
