// Cloudflare Worker sitting in front of the Pages site. It does three
// things and passes everything else straight through:
//
//   /?nimi=X        rewrites the link-preview tags for that name
//   /og.png?nimi=X  draws the preview image
//   /api/tokiponize?name=X   JSON, for tools that aren't JavaScript
//   /api/suggest    POST, files a reader's own reading of a name
//   /api/queue      GET, names other readers have flagged
//   /api/vote       POST, agree or disagree with a filed reading
//
// Deploy: npm run build && npx wrangler deploy -c api/wrangler.toml

import { isValidName, tokiponize } from "../dist/index.js";
import { prepareAtlas, renderCard } from "./og-card.mjs";

const SITE = "https://nimi.toki.li";
// bump when the card art changes: cached images live in Cloudflare and in
// Discord, and neither of them will fetch the same URL twice
const CARD = 2;
const MAX_NAME = 60;
const MAX_NOTE = 280;
const RATE_LIMIT = 120;
// a coarse ceiling on anything that writes, before the body is even read
const WRITE_LIMIT = 60;
// a complaint costs a review, so the box under a result stays tight. an
// answer from the queue is the thing we want most of, and rides the
// ceiling above instead
const COMPLAINT_LIMIT = 8;
// a vote is one tap, so the queue is no fun at eight of them a minute
const VOTE_LIMIT = 40;
// how many the queue hands out at once, and how many rows it reads to
// find them, since rows the engine has caught up with are skipped
const QUEUE_SIZE = 8;
const QUEUE_SCAN = 60;
// ids the caller says it has already been given, so somebody working
// through the queue keeps getting names they have not seen
const MAX_SEEN = 200;
// answers and votes a name collects before it stops being handed out. past
// this the pile is not learning anything new about it, and the effort is
// better spent on a name nobody has read yet
const RESPONSE_CAP = 20;
const WINDOW_MS = 60_000;

const reads = new Map();
const writes = new Map();
const complaints = new Map();
const ballots = new Map();

function limited(bucket, ip, cap) {
  const now = Date.now();
  const h = bucket.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    bucket.set(ip, { start: now, count: 1 });
    if (bucket.size > 10_000) bucket.clear();
    return false;
  }
  h.count++;
  return h.count > cap;
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

function json(data, status = 200, cache = "public, max-age=3600") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": cache,
    },
  });
}

const titleCase = (name) =>
  name
    .split(" ")
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

// Files a reader's own reading of a name. Our answer and its rank are
// worked out here rather than read from the request, and nothing about the
// sender is stored.
async function suggest(request, env, ip) {
  if (limited(writes, ip, WRITE_LIMIT)) {
    return json({ error: `slow down: ${WRITE_LIMIT}/minute` }, 429, "no-store");
  }
  if (!env?.SUGGESTIONS) {
    return json({ error: "suggestions are closed" }, 503, "no-store");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400, "no-store");
  }

  const source = clean(body?.name);
  const raw = clean(body?.suggestion);
  if (!source || !raw) {
    return json({ error: "need both name and suggestion" }, 400, "no-store");
  }
  const suggestion = titleCase(raw);
  if (!suggestion.split(" ").every((w) => isValidName(w))) {
    return json(
      { error: "that is not sayable in toki pona", suggestion },
      422,
      "no-store",
    );
  }

  const engine = body?.engine === "experimental" ? "experimental" : "rules";
  const ours = tokiponize(source, {
    limit: 8,
    experimental: engine === "experimental",
  });
  if (!ours.length) {
    return json({ error: "nothing readable in that name" }, 422, "no-store");
  }
  const via = body?.via === "queue" ? "queue" : "result";
  if (via === "result" && limited(complaints, ip, COMPLAINT_LIMIT)) {
    return json(
      { error: `slow down: ${COMPLAINT_LIMIT}/minute` },
      429,
      "no-store",
    );
  }
  const rank = ours.findIndex((c) => c.name === suggestion);
  // from the box under a result, agreeing with the tool says nothing. from
  // the queue it is an answer to somebody else's complaint, so it counts.
  if (rank === 0 && via === "result") {
    return json(
      { error: "that is already the top suggestion", ours: ours[0].name },
      409,
      "no-store",
    );
  }

  const note = (body?.note ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NOTE);
  let filed;
  try {
    filed = await env.SUGGESTIONS.prepare(
      "INSERT INTO suggestions " +
        "(created, source, suggestion, ours, rank, engine, note, via) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(
        new Date().toISOString(),
        source,
        suggestion,
        ours[0].name,
        rank,
        engine,
        note || null,
        via,
      )
      .first();
  } catch {
    return json(
      { error: "could not file that, try again later" },
      500,
      "no-store",
    );
  }
  return json(
    {
      ok: true,
      id: filed?.id ?? null,
      source,
      suggestion,
      ours: ours[0].name,
      rank,
    },
    201,
    "no-store",
  );
}

// Names other readers have flagged, for someone to read for themselves.
// The reading that was filed is deliberately not in the list: it arrives
// only from ?id=, which the site asks for once the visitor has answered or
// has said they would rather just look.
//
// Complaints only, one per name. Answers that came back from this queue are
// data for review rather than fresh complaints, and putting them back in
// would ask the next visitor to judge the last visitor. Rows the rules have
// caught up with since they were filed are dropped on the way past.
async function queue(url, env, ip) {
  if (limited(reads, ip, RATE_LIMIT)) {
    return json({ error: "slow down: 120/minute" }, 429, "no-store");
  }
  if (!env?.SUGGESTIONS) return json({ items: [] }, 200, "no-store");

  const stale = (row) =>
    tokiponize(row.source, { limit: 1 })[0]?.name === row.suggestion;

  const id = Number(url.searchParams.get("id"));
  if (id) {
    const row = await env.SUGGESTIONS.prepare(
      "SELECT id, source, suggestion, ours, note, up, down FROM suggestions " +
        "WHERE id = ? AND status = 'new'",
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "no such name in the queue" }, 404, "no-store");
    return json({ item: row }, 200, "no-store");
  }

  // ?seen= lets somebody keep going past the first handful: whatever they
  // have already been given is left out of the next one
  const skip = (url.searchParams.get("seen") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_SEEN);
  const holes = skip.length
    ? ` AND s.id NOT IN (${skip.map(() => "?").join(",")})`
    : "";

  // responses counts the votes on the complaint and the readings the queue
  // has collected for that name, since a visitor may do either or both.
  // least-answered first so coverage spreads, random within that so two
  // people rarely get the same names.
  const { results = [] } = await env.SUGGESTIONS.prepare(
    "SELECT s.id, s.source, s.suggestion, s.ours, s.up, s.down, " +
      "s.up + s.down + (SELECT COUNT(*) FROM suggestions q " +
      "WHERE q.via = 'queue' AND q.source = s.source) AS responses " +
      "FROM suggestions s " +
      "WHERE s.status = 'new' AND s.via = 'result'" +
      holes +
      " ORDER BY responses ASC, RANDOM() LIMIT ?",
  )
    .bind(...skip, QUEUE_SCAN)
    .all();

  const items = [];
  const names = new Set();
  for (const row of results) {
    if (row.responses >= RESPONSE_CAP) continue;
    if (stale(row) || names.has(row.source)) continue;
    names.add(row.source);
    // the filed reading stays out of this response on purpose
    items.push({
      id: row.id,
      source: row.source,
      ours: row.ours,
      up: row.up,
      down: row.down,
    });
    if (items.length === QUEUE_SIZE) break;
  }
  return json({ items }, 200, "no-store");
}

// Agreeing or disagreeing with a filed reading. Tallies only: there is no
// identity here to hang one-per-person on, so this is rate limited instead.
async function vote(request, env, ip) {
  if (limited(ballots, ip, VOTE_LIMIT)) {
    return json({ error: `slow down: ${VOTE_LIMIT}/minute` }, 429, "no-store");
  }
  if (!env?.SUGGESTIONS) {
    return json({ error: "voting is closed" }, 503, "no-store");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400, "no-store");
  }
  const id = Number(body?.id);
  const column = body?.vote === "up" ? "up" : body?.vote === "down" ? "down" : null;
  if (!Number.isInteger(id) || id < 1 || !column) {
    return json({ error: "need an id and a vote of up or down" }, 400, "no-store");
  }

  const row = await env.SUGGESTIONS.prepare(
    `UPDATE suggestions SET ${column} = ${column} + 1 ` +
      "WHERE id = ? AND status = 'new' RETURNING id, up, down",
  )
    .bind(id)
    .first();
  if (!row) return json({ error: "no such name in the queue" }, 404, "no-store");
  return json({ ok: true, ...row }, 200, "no-store");
}

const preflight = () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });

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
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const ip = request.headers.get("cf-connecting-ip") ?? "?";

      if (url.pathname === "/api/suggest" || url.pathname === "/api/vote") {
        if (request.method === "OPTIONS") return preflight();
        if (request.method !== "POST") {
          return json({ error: "POST only" }, 405, "no-store");
        }
        return url.pathname === "/api/vote"
          ? vote(request, env, ip)
          : suggest(request, env, ip);
      }

      if (url.pathname === "/api/queue") return queue(url, env, ip);

      if (url.pathname === "/api/tokiponize") {
        if (limited(reads, ip, RATE_LIMIT)) {
          return json({ error: "slow down: 120/minute" }, 429);
        }
        const name = clean(url.searchParams.get("name"));
        if (!name) return json({ error: "missing ?name=" }, 400);
        const candidates = tokiponize(name, {
          limit: Math.min(8, Math.max(1, Number(url.searchParams.get("limit")) || 4)),
          experimental: url.searchParams.get("experimental") === "1",
        });
        return json({ name, best: candidates[0]?.name ?? null, candidates });
      }

      if (url.pathname === "/og.png") {
        if (limited(reads, ip, RATE_LIMIT)) {
          return new Response("slow down", { status: 429 });
        }
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
