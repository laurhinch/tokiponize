// sitemap.xml for the Pages site: the homepage plus a ?nimi= URL per name
// from eval/data/popular-names.csv.
//
// Usage: node scripts/build-sitemap.mjs _site [--limit 1000]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://nimi.toki.li";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--")) ?? "_site";
const limitAt = args.indexOf("--limit");
const limit = limitAt === -1 ? 1000 : Number(args[limitAt + 1]);

const xml = (s) =>
  s.replace(/[<>&'"]/g, (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", "'": "apos", '"': "quot" }[c]};`);

// the harvest is already sorted by popularity
function names() {
  const csv = join(root, "eval", "data", "popular-names.csv");
  if (!existsSync(csv)) {
    console.warn(`no ${csv}, sitemap gets the homepage only`);
    return [];
  }
  const lines = readFileSync(csv, "utf8").replace(/^﻿/, "").split("\n");
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cell = line.startsWith('"')
      ? line.slice(1, line.indexOf('"', 1)).replace(/""/g, '"')
      : line.slice(0, line.indexOf(","));
    if (cell) out.push(cell);
    if (out.length === limit) break;
  }
  return out;
}

const today = new Date().toISOString().slice(0, 10);
const urls = [
  `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
];
for (const name of names()) {
  const loc = `${SITE}/?nimi=${encodeURIComponent(name)}`;
  urls.push(`  <url>\n    <loc>${xml(loc)}</loc>\n    <priority>0.6</priority>\n  </url>`);
}

const out = join(outDir, "sitemap.xml");
writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`,
);
console.log(`wrote ${out} with ${urls.length} urls`);
