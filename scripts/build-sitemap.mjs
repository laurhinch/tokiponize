// sitemap.xml and names.html for the Pages site, both covering a ?nimi= URL
// per row of eval/data/proper-nouns.csv and eval/data/popular-names.csv. The
// sitemap gets them crawled, names.html is what links to them.
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

// Given names only. toki pona names a place or a language by what it calls
// itself, so reading the English spelling is the wrong operation for those
// and eval/data/proper-nouns.csv stays out of the index.
const entries = rows("popular-names.csv")
  .slice(0, nameLimit)
  .map((r) => ({ name: r.name, reading: r.rules_best ?? "" }));

const href = (name) => `${SITE}/?nimi=${encodeURIComponent(name)}`;
const today = new Date().toISOString().slice(0, 10);

const urls = [
  `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  `  <url>\n    <loc>${SITE}/names.html</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <priority>0.8</priority>\n  </url>`,
];
for (const e of entries) {
  urls.push(`  <url>\n    <loc>${xml(href(e.name))}</loc>\n    <priority>0.6</priority>\n  </url>`);
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

const items = entries
  .map(
    (e) =>
      `<li><a href="${xml(href(e.name))}">${xml(e.name)}</a>` +
      (e.reading ? ` <span>${xml(e.reading)}</span>` : "") +
      `</li>`,
  )
  .join("\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>every name on nimi.toki.li</title>
<meta name="description" content="The ${entries.length} most common given names, each written in toki pona.">
<link rel="canonical" href="${SITE}/names.html">
<meta name="theme-color" content="#f4ecdd">
<link rel="icon" type="image/png" sizes="512x512" href="icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400..800&family=Nunito:wght@400..900&display=swap" rel="stylesheet">
<style>
:root { --cream:#f4ecdd; --teal:#7ccfbe; --black:#332e26; --white:#fffdf6; --yellow:#ffd98c; }
* { box-sizing:border-box }
body { margin:0; padding:3rem 1rem 4rem; background:var(--cream);
  background-image:radial-gradient(rgba(51,46,38,.08) 1px, transparent 1px); background-size:22px 22px;
  color:var(--black); font-family:"Nunito","Segoe UI",sans-serif; font-weight:600 }
main { max-width:52rem; margin:0 auto }
h1 { display:inline-block; background:var(--yellow); border:3px solid var(--black); border-radius:10px;
  box-shadow:4px 4px 0 var(--black); padding:.05em .55em .1em; text-transform:uppercase;
  font-family:"Baloo 2","Nunito",sans-serif; font-size:1.6rem; transform:rotate(-1.2deg); margin:0 0 1rem }
p.lede { color:#57503f; font-size:.95rem; max-width:34rem }
h2 { font-family:"Baloo 2","Nunito",sans-serif; text-transform:uppercase; font-size:1rem;
  letter-spacing:.04em; margin:2.5rem 0 .75rem }
h2 em { font-style:normal; color:#6b6350; font-weight:400 }
ul { list-style:none; padding:0; margin:0; display:grid; gap:.4rem;
  grid-template-columns:repeat(auto-fill,minmax(13rem,1fr)) }
li { background:var(--white); border:3px solid var(--black); border-radius:10px; padding:.45rem .7rem;
  display:flex; justify-content:space-between; gap:.5rem; align-items:baseline }
a { color:var(--black); text-decoration:none }
a:hover { text-decoration:underline }
li span { background:var(--teal); border-radius:6px; padding:0 .4em; font-size:.9rem }
footer { max-width:52rem; margin:3rem auto 0; font-size:.9rem }
</style>
</head>
<body>
<main>
<h1>every name</h1>
<p class="lede">${entries.length} names, each with the reading tokiponize gives it.</p>
<ul>
${items}
</ul>
</main>
<footer><a href="/">back to tokiponize</a></footer>
</body>
</html>
`;

const index = join(outDir, "names.html");
writeFileSync(index, page);
console.log(`wrote ${index}: ${entries.length} links`);
