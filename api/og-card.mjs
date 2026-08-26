// Draw the link-preview card for one name. Web APIs only, so this runs
// unchanged in a Cloudflare Worker.

const W = 1200;
const H = 630;
const CREAM = [244, 236, 221];
const TEAL = [124, 207, 190];
const BLACK = [51, 46, 38];
const MUTED = [87, 80, 63];

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const buf = await new Response(
    new Blob([bytes]).stream().pipeThrough(ds),
  ).arrayBuffer();
  return new Uint8Array(buf);
}

/** decode the base64+deflate blobs once, then reuse */
export async function prepareAtlas(atlas) {
  for (const key of ["big", "small"]) {
    atlas[key].pixels = await inflate(b64(atlas[key].blob));
  }
  return atlas;
}

function measure(font, text, scale = 1) {
  let w = 0;
  for (const ch of text) w += (font.glyphs[ch]?.adv ?? 0) * scale;
  return w;
}

function drawText(buf, font, text, x, y, color, scale = 1) {
  let pen = x;
  for (const ch of text) {
    const g = font.glyphs[ch];
    if (!g) continue;
    if (g.w) {
      const dw = Math.round(g.w * scale);
      const dh = Math.round(g.h * scale);
      const ox = Math.round(pen + g.left * scale);
      const oy = Math.round(y + g.top * scale);
      for (let dy = 0; dy < dh; dy++) {
        // sample the source bitmap, so long names can shrink to fit
        const sy = Math.min(g.h - 1, Math.floor(dy / scale));
        const py = oy + dy;
        if (py < 0 || py >= H) continue;
        for (let dx = 0; dx < dw; dx++) {
          const sx = Math.min(g.w - 1, Math.floor(dx / scale));
          const a = font.pixels[g.off + sy * g.w + sx] / 255;
          if (a < 0.004) continue;
          const px = ox + dx;
          if (px < 0 || px >= W) continue;
          const i = (py * W + px) * 3;
          for (let c = 0; c < 3; c++) {
            buf[i + c] = color[c] * a + buf[i + c] * (1 - a);
          }
        }
      }
    }
    pen += g.adv * scale;
  }
}

function fillRect(buf, x0, y0, w, h, color) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 3;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }
}

function roundRect(buf, x0, y0, w, h, r, color) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0);
      const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      const i = (y * W + x) * 3;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

async function encodePng(rgb) {
  const raw = new Uint8Array((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const cs = new CompressionStream("deflate");
  const idat = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer(),
  );
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** source is shown only if the atlas covers it (ASCII) */
export async function renderCard(atlas, source, result) {
  const buf = new Uint8Array(W * H * 3);
  fillRect(buf, 0, 0, W, H, CREAM);
  for (let y = 2; y < H; y += 22) {
    for (let x = 2; x < W; x += 22) fillRect(buf, x, y, 2, 2, [222, 213, 197]);
  }

  const small = atlas.small;
  const big = atlas.big;

  const clean = [...source].filter((c) => small.glyphs[c]).join("");
  if (clean && clean.length >= source.length * 0.7) {
    const w = measure(small, clean);
    drawText(buf, small, clean, (W - w) / 2, 196, MUTED);
  }

  let scale = 1;
  let tw = measure(big, result);
  const maxText = 880;
  if (tw > maxText) {
    scale = maxText / tw;
    tw = maxText;
  }
  const boxW = Math.min(W - 140, tw + 120);
  const boxH = 190;
  const boxX = Math.round((W - boxW) / 2);
  const boxY = 250;
  roundRect(buf, boxX + 10, boxY + 10, boxW, boxH, 30, BLACK);
  roundRect(buf, boxX, boxY, boxW, boxH, 30, BLACK);
  roundRect(buf, boxX + 8, boxY + 8, boxW - 16, boxH - 16, 24, TEAL);
  drawText(buf, big, result, (W - tw) / 2, boxY + 128, BLACK, scale);

  const domain = "nimi.toki.li";
  drawText(buf, small, domain, W - 84 - measure(small, domain), 556, MUTED);

  return encodePng(buf);
}
