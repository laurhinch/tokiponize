// sitemap.xml for the Pages site: the homepage plus a ?nimi= URL per row of
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

// the harvest sorts most-known first
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

// Given names only. toki pona names a place or a language by what it calls
// itself, so reading the English spelling is the wrong operation for those
// and eval/data/proper-nouns.csv stays out of the index.
const entries = rows("popular-names.csv").slice(0, nameLimit);

const today = new Date().toISOString().slice(0, 10);
const urls = [
  `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
];
for (const e of entries) {
  const loc = `${SITE}/?nimi=${encodeURIComponent(e.name)}`;
  urls.push(`  <url>\n    <loc>${xml(loc)}</loc>\n    <priority>0.6</priority>\n  </url>`);
}

const sitemap = join(outDir, "sitemap.xml");
writeFileSync(
  sitemap,
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`,
);
console.log(`wrote ${sitemap}: ${urls.length} urls`);
