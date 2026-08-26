// Cloudflare Worker exposing tokiponize over HTTP.
// Deploy with: npm run build && npx wrangler deploy -c api/wrangler.toml

import { isValidName, syllabify, tokiponize } from "../dist/index.js";

const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
const MAX_LIMIT = 8;
const MAX_NAME = 120;

// best-effort fixed window per isolate; add a Cloudflare rate rule on the
// zone if you need a hard guarantee
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

export default {
  fetch(req) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (limited(ip)) {
      return json({ error: "rate limited, max 60 requests per minute" }, 429);
    }

    const name = url.searchParams.get("name")?.trim().slice(0, MAX_NAME);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 4));
    const experimental = url.searchParams.get("experimental") === "1";

    if (url.pathname.endsWith("/tokiponize")) {
      if (!name) return json({ error: "missing ?name=" }, 400);
      const candidates = tokiponize(name, { limit, experimental });
      return json({ name, best: candidates[0]?.name ?? null, candidates });
    }

    if (url.pathname.endsWith("/check")) {
      if (!name) return json({ error: "missing ?name=" }, 400);
      const valid = isValidName(name);
      return json({ name, valid, syllables: valid ? syllabify(name) : null });
    }

    return json({
      error: "not found",
      endpoints: [
        "GET /api/tokiponize?name=Jakarta&limit=4&experimental=1",
        "GET /api/check?name=Koti",
      ],
    }, 404);
  },
};
