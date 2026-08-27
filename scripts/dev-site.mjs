// Local site, with the API routes attached so the correction box and the
// queue both work.
//
//   npm run site
//
// Serves site/ on 8787, which is the port site/index.html falls back to when
// it is loaded from localhost, so /api/suggest is same-origin. /lib is read
// straight out of dist/, so `npm run build -- --watch` in another terminal is
// enough to pick up library changes. Suggestions land in a local SQLite file
// rather than D1, so nothing here needs a Cloudflare account.

import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT) || 8787;
const DB_FILE = ".dev-suggestions.sqlite";
// only these reach the worker. anything else it does not handle ends in a
// passthrough fetch, and with a production URL that is a real request to the
// live site, which is no way to run a local test
const ROUTES = [
  "/api/tokiponize",
  "/api/suggest",
  "/api/queue",
  "/api/vote",
];

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error(
    "node:sqlite is missing, so this needs Node 22.5 or newer (the library " +
      "itself still runs on 20).",
  );
  process.exit(1);
}

if (!existsSync("dist/index.js")) {
  console.error("dist/ is empty, run npm run build first");
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);
// every migration, in order, the way the deploy workflow applies them.
// re-running them is what ALTER TABLE cannot survive, so a fresh file is
// the way back if you have changed one
const MIGRATIONS = "api/migrations";
for (const file of readdirSync(MIGRATIONS).sort()) {
  if (!file.endsWith(".sql")) continue;
  try {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}

// the shape worker.mjs asks of a D1 binding, and no more
const env = {
  SUGGESTIONS: {
    prepare: (sql) => ({
      bind: (...args) => ({
        run: async () => {
          db.prepare(sql).run(...args);
          return { success: true };
        },
        all: async () => ({ results: db.prepare(sql).all(...args), success: true }),
        first: async () => db.prepare(sql).get(...args) ?? null,
      }),
    }),
  },
};

const worker = (await import("../api/worker.mjs")).default;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function staticFile(pathname) {
  // /lib comes from the build output, everything else from site/
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = rel.startsWith("lib/")
    ? join("dist", rel.slice(4))
    : join("site", rel);
  const safe = normalize(file);
  if (safe.startsWith("..")) return null;
  return existsSync(safe) && statSync(safe).isFile() ? safe : null;
}

async function api(req, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`https://nimi.toki.li${url.pathname}${url.search}`, {
    method: req.method,
    headers: { ...req.headers, "cf-connecting-ip": "127.0.0.1" },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  return worker.fetch(request, env);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // what the box has filed so far, for checking your own testing
  if (url.pathname === "/dev/suggestions") {
    const rows = db.prepare("SELECT * FROM suggestions ORDER BY id DESC").all();
    res.writeHead(200, { "content-type": TYPES[".json"] });
    return res.end(JSON.stringify(rows, null, 2));
  }

  if (url.pathname.startsWith("/api/")) {
    if (!ROUTES.includes(url.pathname)) {
      res.writeHead(404, { "content-type": TYPES[".json"] });
      console.log(`${req.method} ${url.pathname} -> 404, not a worker route`);
      return res.end('{"error":"not a route this worker handles"}');
    }
    try {
      const out = await api(req, url);
      const body = Buffer.from(await out.arrayBuffer());
      res.writeHead(out.status, Object.fromEntries(out.headers));
      console.log(`${req.method} ${url.pathname} -> ${out.status}`);
      return res.end(body);
    } catch (err) {
      console.error(`${req.method} ${url.pathname} failed:`, err.message);
      res.writeHead(500, { "content-type": TYPES[".json"] });
      return res.end(`{"error":"${err.message}"}`);
    }
  }

  const file = staticFile(url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not here");
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`site      http://localhost:${PORT}/`);
  console.log(`a name    http://localhost:${PORT}/?nimi=Flavor%20Foley`);
  console.log(`filed     http://localhost:${PORT}/dev/suggestions`);
  console.log(`queue     http://localhost:${PORT}/api/queue`);
  console.log(`rows in   ${DB_FILE}`);
});
