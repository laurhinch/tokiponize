// Cloudflare Worker sitting in front of the Pages site. It does three
// things and passes everything else straight through:
//
//   /?nimi=X        rewrites the link-preview tags for that name
//   /og.png?nimi=X  draws the preview image
//   /api/tokiponize?name=X   JSON, for tools that aren't JavaScript
//
// Deploy: npm run build && npx wrangler deploy -c api/wrangler.toml

import { tokiponize } from "../dist/index.js";
import { prepareAtlas, renderCard } from "./og-card.mjs";

const SITE = "https://nimi.toki.li";
// bump when the card art changes: cached images live in Cloudflare and in
// Discord, and neither of them will fetch the same URL twice
const CARD = 2;
const MAX_NAME = 60;
const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;

const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  h.count++;
  return h.count > RATE_LIMIT;
}

let atlasPromise = null;
let atlasFetched = 0;
const ATLAS_TTL = 15 * 60_000;

function atlas() {
  // re-read now and then: a new atlas ships with the site, not with this
  // worker, so caching it forever means a fixed glyph never arrives
  if (atlasPromise && Date.now() - atlasFetched > ATLAS_TTL) atlasPromise = null;
  if (!atlasPromise) {
    atlasFetched = Date.now();
    // drop a failed fetch, or one bad moment would poison this isolate
    atlasPromise = fetch(`${SITE}/og-atlas.json`, { cf: { cacheTtl: 60 } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(prepareAtlas)
      .catch((err) => {
        atlasPromise = null;
        throw err;
      });
  }
  return atlasPromise;
}

const clean = (v) => (v ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
const escape = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}

async function ogImage(name) {
  const best = tokiponize(name, { limit: 1 })[0]?.name;
  if (!best) return null;
  const png = await renderCard(await atlas(), name, best);
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

// swap the preview tags in the page Pages already serves
function rewriteMeta(res, name, candidates) {
  const best = candidates[0].name;
  const others = candidates.slice(1, 4).map((c) => c.name);
  const title = `${name} → ${best}`;
  const description = others.length
    ? `${name} in toki pona. Also ${others.join(", ")}.`
    : `${name} in toki pona.`;
  const url = `${SITE}/?nimi=${encodeURIComponent(name)}`;
  const image = `${SITE}/og.png?nimi=${encodeURIComponent(name)}&v=${CARD}`;

  const set = (value) => ({
    element: (el) => el.setAttribute("content", value),
  });
  return new HTMLRewriter()
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(description))
    .on('meta[name="description"]', set(description))
    .on('meta[property="og:url"]', set(url))
    .on('meta[property="og:image"]', set(image))
    .on("title", {
      element: (el) => el.setInnerContent(escape(title), { html: true }),
    })
    .transform(res);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      const ip = request.headers.get("cf-connecting-ip") ?? "?";

      if (url.pathname === "/api/tokiponize") {
        if (limited(ip)) return json({ error: "slow down: 120/minute" }, 429);
        const name = clean(url.searchParams.get("name"));
        if (!name) return json({ error: "missing ?name=" }, 400);
        const candidates = tokiponize(name, {
          limit: Math.min(8, Math.max(1, Number(url.searchParams.get("limit")) || 4)),
          experimental: url.searchParams.get("experimental") === "1",
        });
        return json({ name, best: candidates[0]?.name ?? null, candidates });
      }

      if (url.pathname === "/og.png") {
        if (limited(ip)) return new Response("slow down", { status: 429 });
        const res = await ogImage(clean(url.searchParams.get("nimi")));
        if (res) return res;
        return Response.redirect(`${SITE}/card.png`, 302);
      }

      const name = clean(url.searchParams.get("nimi"));
      if (url.pathname === "/" && name) {
        const candidates = tokiponize(name, { limit: 4 });
        const res = await fetch(request);
        if (candidates.length && res.headers.get("content-type")?.includes("text/html")) {
          return rewriteMeta(res, name, candidates);
        }
        return res;
      }
    } catch {
      // never let this worker be the reason the site is down
    }
    return fetch(request);
  },
};
