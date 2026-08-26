// Regenerate site/og-atlas.json, the glyph bitmaps og-card.mjs blits.
// Only needed if the card design or its fonts change.
//
//   npm i --no-save @resvg/resvg-js opentype.js && node api/build-atlas.mjs
//
// Glyphs are rasterized by drawing real text, not by extracting outlines:
// opentype.js returns a broken path for Baloo 2's "m". Advances still come
// from the font's metrics, which are just numbers and are fine.

import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FONTS = {
  big: {
    size: 104,
    family: "Baloo 2",
    css: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@700",
  },
  small: {
    size: 34,
    family: "Nunito",
    css: "https://fonts.googleapis.com/css2?family=Nunito:wght@700",
  },
};

const CHARS = [];
for (let c = 32; c <= 126; c++) CHARS.push(String.fromCharCode(c));

async function loadFont(cssUrl) {
  const css = await (await fetch(cssUrl, {
    headers: { "user-agent": "Mozilla/5.0" },
  })).text();
  const url = css.match(/https:\/\/[^)]*\.ttf/)?.[0];
  if (!url) throw new Error(`no ttf in ${cssUrl}`);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return { bytes, font: opentype.parse(bytes.buffer) };
}

function buildAtlas({ bytes, font }, size, family, file) {
  writeFileSync(file, bytes);
  const pad = Math.ceil(size * 0.8);
  const base = Math.ceil(size * 1.5);
  const height = Math.ceil(size * 2.2);
  const opts = {
    font: { fontFiles: [file], loadSystemFonts: false, defaultFontFamily: family },
  };

  const glyphs = {};
  const chunks = [];
  let offset = 0;

  for (const ch of CHARS) {
    const glyph = font.charToGlyph(ch);
    const adv = (glyph.advanceWidth / font.unitsPerEm) * size;
    const entry = { adv: +adv.toFixed(2), w: 0, h: 0, left: 0, top: 0, off: offset };
    const width = Math.ceil(adv) + pad * 2;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="${pad}" y="${base}" font-family="${family}" font-size="${size}" ` +
      `fill="#000">&#${ch.codePointAt(0)};</text></svg>`;
    const img = new Resvg(svg, opts).render();
    const px = img.pixels;

    // crop to the ink so the atlas stores no empty margins
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (px[(y * width + x) * 4 + 3] > 2) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX >= minX) {
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const alpha = Buffer.alloc(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          alpha[y * w + x] = px[((minY + y) * width + (minX + x)) * 4 + 3];
        }
      }
      chunks.push(alpha);
      Object.assign(entry, { w, h, left: minX - pad, top: minY - base });
      offset += alpha.length;
    }
    glyphs[ch] = entry;
  }

  return {
    size,
    glyphs,
    blob: deflateSync(Buffer.concat(chunks), { level: 9 }).toString("base64"),
  };
}

const atlas = {};
for (const [key, cfg] of Object.entries(FONTS)) {
  const loaded = await loadFont(cfg.css);
  atlas[key] = buildAtlas(loaded, cfg.size, cfg.family, `atlas-${key}.ttf`);
}
const out = new URL("../site/og-atlas.json", import.meta.url);
writeFileSync(out, JSON.stringify(atlas));
console.log("wrote", out.pathname, JSON.stringify(atlas).length, "bytes");
