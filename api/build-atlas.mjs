// Regenerate site/og-atlas.json, the glyph bitmaps og-card.mjs blits.
// Only needed if the card design or its fonts change.
//
//   cd api && npm i --no-save @resvg/resvg-js opentype.js && node build-atlas.mjs

import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FONTS = {
  big: {
    size: 104,
    css: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@700",
  },
  small: {
    size: 34,
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
  return opentype.parse(await (await fetch(url)).arrayBuffer());
}

function buildAtlas(font, size) {
  const glyphs = {};
  const chunks = [];
  let offset = 0;

  for (const ch of CHARS) {
    const glyph = font.charToGlyph(ch);
    const adv = (glyph.advanceWidth / font.unitsPerEm) * size;
    const path = glyph.getPath(0, 0, size);
    const bb = path.getBoundingBox();
    const entry = { adv: +adv.toFixed(2), w: 0, h: 0, left: 0, top: 0, off: offset };

    if (isFinite(bb.x1) && bb.x2 > bb.x1 && bb.y2 > bb.y1) {
      const left = Math.floor(bb.x1) - 1;
      const top = Math.floor(bb.y1) - 1;
      const w = Math.ceil(bb.x2 - left) + 1;
      const h = Math.ceil(bb.y2 - top) + 1;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<g transform="translate(${-left} ${-top})">` +
        `<path d="${path.toPathData(2)}" fill="#000"/></g></svg>`;
      const px = new Resvg(svg, {}).render().pixels;
      const alpha = Buffer.alloc(w * h);
      for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
      chunks.push(alpha);
      Object.assign(entry, { w, h, left, top });
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
  atlas[key] = buildAtlas(await loadFont(cfg.css), cfg.size);
}
const out = new URL("../site/og-atlas.json", import.meta.url);
writeFileSync(out, JSON.stringify(atlas));
console.log("wrote", out.pathname, JSON.stringify(atlas).length, "bytes");
