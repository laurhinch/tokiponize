// api/worker.mjs has no types and swallows every error on purpose, so a
// broken worker looks exactly like a working one from outside. These pin the
// route contract instead.
//
// Two things are deliberately not covered here. rewriteMeta uses
// HTMLRewriter, which only exists in workerd, so the / route is checked for
// the decision it makes rather than the HTML it emits, and the deploy step in
// worker.yml greps the real thing. And fetch is stubbed throughout, because
// the passthrough and the atlas read both point at the live site.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const at = (path: string) => fileURLToPath(new URL(path, ROOT));

const ATLAS = readFileSync(at("site/og-atlas.json"), "utf8");
const PAGE = '<!doctype html><title>x</title><meta property="og:title" content="x">';

const worker = (await import(new URL("../../api/worker.mjs", import.meta.url).href))
  .default as { fetch(request: Request, env?: unknown): Promise<Response> };

// each test gets its own address, or the rate limit buckets leak between them
let host = 0;
const ip = () => `10.0.0.${++host}`;

let passthrough: string[] = [];
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    passthrough.push(url);
    if (url.endsWith("/og-atlas.json")) {
      return new Response(ATLAS, {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

/** the shape worker.mjs asks of a D1 binding, answering from a fixed list */
function fakeDb(rows: Record<string, unknown>[] = []) {
  const ran: { sql: string; args: unknown[] }[] = [];
  return {
    ran,
    env: {
      SUGGESTIONS: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            ran.push({ sql, args });
            return {
              run: async () => ({ success: true }),
              all: async () => ({ results: rows, success: true }),
              first: async () => rows[0] ?? null,
            };
          },
        }),
      },
    },
  };
}

/** the JSON body, left untyped because these tests are the shape check */
const bodyOf = async (res: Response): Promise<any> => await res.json();

const get = (path: string, from = ip()) =>
  worker.fetch(
    new Request(`https://nimi.toki.li${path}`, {
      headers: { "cf-connecting-ip": from },
    }),
  );

const post = (path: string, body: unknown, env?: unknown, from = ip()) =>
  worker.fetch(
    new Request(`https://nimi.toki.li${path}`, {
      method: "POST",
      headers: { "cf-connecting-ip": from, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );

describe("/api/tokiponize", () => {
  test("answers with the name, the best fit, and the alternatives", async () => {
    const res = await get("/api/tokiponize?name=Lauren");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");

    const body = await bodyOf(res);
    assert.equal(body.name, "Lauren");
    assert.equal(body.best, body.candidates[0].name);
    assert.ok(body.candidates.length > 1, "one candidate is not a list");
    for (const c of body.candidates) {
      assert.equal(typeof c.name, "string");
      assert.equal(typeof c.score, "number");
    }
  });

  test("a missing name is a 400, not an empty answer", async () => {
    const res = await get("/api/tokiponize");
    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).error, "missing ?name=");
  });

  test("blank and whitespace-only names are missing names", async () => {
    assert.equal((await get("/api/tokiponize?name=")).status, 400);
    assert.equal((await get("/api/tokiponize?name=%20%20")).status, 400);
  });

  test("limit is clamped to something a caller cannot abuse", async () => {
    const many = await bodyOf(await get("/api/tokiponize?name=Christopher&limit=999"));
    assert.ok(many.candidates.length <= 8, "limit is not capped at 8");

    const none = await bodyOf(await get("/api/tokiponize?name=Christopher&limit=0"));
    assert.ok(none.candidates.length >= 1, "limit=0 should still answer");

    const junk = await bodyOf(await get("/api/tokiponize?name=Christopher&limit=abc"));
    assert.ok(junk.candidates.length >= 1, "a junk limit should fall back");
  });

  test("the experimental engine is opt-in by query string", async () => {
    const res = await get("/api/tokiponize?name=Lauren&experimental=1");
    assert.equal(res.status, 200);
    assert.ok((await bodyOf(res)).candidates.length);
  });

  test("a name it cannot read answers 200 with a null best", async () => {
    const body = await bodyOf(await get("/api/tokiponize?name=%21%21%21"));
    assert.equal(body.best, null);
    assert.deepEqual(body.candidates, []);
  });

  test("past the ceiling it answers 429 rather than working harder", async () => {
    const from = ip();
    let last = await get("/api/tokiponize?name=Lauren", from);
    for (let i = 0; i < 130 && last.status !== 429; i++) {
      last = await get("/api/tokiponize?name=Lauren", from);
    }
    assert.equal(last.status, 429, "the read limit never tripped");
    assert.equal(last.headers.get("cache-control"), "no-store");
  });
});

describe("/api/suggest", () => {
  test("only POST is allowed", async () => {
    const res = await get("/api/suggest");
    assert.equal(res.status, 405);
    assert.equal((await bodyOf(res)).error, "POST only");
  });

  test("a preflight is answered without touching the database", async () => {
    const res = await worker.fetch(
      new Request("https://nimi.toki.li/api/suggest", {
        method: "OPTIONS",
        headers: { "cf-connecting-ip": ip() },
      }),
    );
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  });

  test("with no database bound it says so instead of failing", async () => {
    const res = await post("/api/suggest", { name: "Lauren", suggestion: "Lowen" });
    assert.equal(res.status, 503);
    assert.equal((await bodyOf(res)).error, "suggestions are closed");
  });

  test("a body that is not JSON is a 400", async () => {
    const res = await post("/api/suggest", "not json at all", fakeDb().env);
    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).error, "expected a JSON body");
  });

  test("both fields are required", async () => {
    const res = await post("/api/suggest", { name: "Lauren" }, fakeDb().env);
    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).error, "need both name and suggestion");
  });

  test("a suggestion that is not sayable is refused", async () => {
    const res = await post(
      "/api/suggest",
      { name: "Lauren", suggestion: "Xqzwv" },
      fakeDb().env,
    );
    assert.equal(res.status, 422);
    assert.equal((await bodyOf(res)).error, "that is not sayable in toki pona");
  });

  test("agreeing with the top pick from a result is a 409", async () => {
    const best = (await bodyOf(await get("/api/tokiponize?name=Lauren"))).best;
    const res = await post(
      "/api/suggest",
      { name: "Lauren", suggestion: best, via: "result" },
      fakeDb().env,
    );
    assert.equal(res.status, 409);
    assert.equal((await bodyOf(res)).ours, best);
  });

  test("the same answer from the queue is filed, because there it means something", async () => {
    const best = (await bodyOf(await get("/api/tokiponize?name=Lauren"))).best;
    const db = fakeDb([{ id: 7 }]);
    const res = await post(
      "/api/suggest",
      { name: "Lauren", suggestion: best, via: "queue" },
      db.env,
    );
    assert.equal(res.status, 201);
    assert.equal((await bodyOf(res)).id, 7);
  });

  test("a filed reading is written with the name, the reading, and our own", async () => {
    const db = fakeDb([{ id: 12 }]);
    const res = await post(
      "/api/suggest",
      { name: "Lauren", suggestion: "Lala", note: "  spaced   out  " },
      db.env,
    );
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("cache-control"), "no-store");

    const body = await bodyOf(res);
    assert.equal(body.ok, true);
    assert.equal(body.source, "Lauren");
    assert.equal(body.suggestion, "Lala");

    assert.equal(db.ran.length, 1, "the suggestion never reached the database");
    assert.match(db.ran[0].sql, /INSERT INTO suggestions/);
    assert.ok(db.ran[0].args.includes("Lauren"));
    assert.ok(
      db.ran[0].args.includes("spaced out"),
      "the note should be collapsed, not stored raw",
    );
  });

  test("a database that throws is a 500, not an unhandled rejection", async () => {
    const env = {
      SUGGESTIONS: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("d1 is having a day");
            },
          }),
        }),
      },
    };
    const res = await post("/api/suggest", { name: "Lauren", suggestion: "Lala" }, env);
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, "could not file that, try again later");
  });
});

describe("/api/queue", () => {
  test("with no database bound it is empty rather than broken", async () => {
    const res = await get("/api/queue");
    assert.equal(res.status, 200);
    assert.deepEqual((await bodyOf(res)).items, []);
  });

  test("an id that is not in the queue is a 404", async () => {
    const res = await worker.fetch(
      new Request("https://nimi.toki.li/api/queue?id=99", {
        headers: { "cf-connecting-ip": ip() },
      }),
      fakeDb([]).env,
    );
    assert.equal(res.status, 404);
  });

  test("a filed reading is never in the listing, only behind ?id=", async () => {
    const row = {
      id: 3,
      source: "Lauren",
      suggestion: "Lala",
      ours: "Lowen",
      up: 0,
      down: 0,
      responses: 0,
    };
    const res = await worker.fetch(
      new Request("https://nimi.toki.li/api/queue", {
        headers: { "cf-connecting-ip": ip() },
      }),
      fakeDb([row]).env,
    );
    const [item] = (await bodyOf(res)).items;
    assert.ok(item, "the row never came back");
    assert.equal(item.source, "Lauren");
    assert.ok(
      !("suggestion" in item),
      "the filed reading leaked into the queue listing",
    );
  });
});

describe("/og.png", () => {
  test("draws a card for a name it can read", async () => {
    const res = await get("/og.png?nimi=Jakarta");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");

    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(
      [...bytes.slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      "that is not a PNG",
    );
  });

  test("falls back to the stock card when there is nothing to draw", async () => {
    const res = await get("/og.png?nimi=%21%21%21");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /card\.png$/);
  });
});

describe("/robots.txt", () => {
  test("is answered here, not by the managed file on the zone", async () => {
    passthrough = [];
    const res = await get("/robots.txt");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    assert.equal(passthrough.length, 0, "robots.txt should not reach Pages");
  });

  test("points crawlers at the sitemap, which is the reason it exists", async () => {
    const body = await (await get("/robots.txt")).text();
    assert.match(body, /^Sitemap: https:\/\/nimi\.toki\.li\/sitemap\.xml$/m);
  });

  test("search engines are allowed and the API is not", async () => {
    const body = await (await get("/robots.txt")).text();
    assert.match(body, /^User-agent: \*$/m);
    assert.match(body, /^Allow: \/$/m);
    assert.match(body, /^Disallow: \/api\/$/m);
  });

  test("the AI crawlers the zone already blocked stay blocked", async () => {
    const body = await (await get("/robots.txt")).text();
    // the managed file blocked these, so ours has to too
    for (const bot of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) {
      assert.match(
        body,
        new RegExp(`^User-agent: ${bot}\\nDisallow: /$`, "m"),
        `${bot} was blocked before this file existed`,
      );
    }
  });
});

describe("everything else is passed through untouched", () => {
  test("a page with no name asks Pages for it and nothing more", async () => {
    passthrough = [];
    await get("/");
    assert.deepEqual(
      passthrough.map((u) => new URL(u).pathname),
      ["/"],
      "a plain page load should be one passthrough",
    );
  });

  test("an unknown path is passed through", async () => {
    passthrough = [];
    const res = await get("/does-not-exist");
    assert.equal(res.status, 200);
    assert.equal(passthrough.length, 1);
  });

  test("a route the worker does not own never reaches the database", async () => {
    const db = fakeDb();
    await worker.fetch(
      new Request("https://nimi.toki.li/icon.png", {
        headers: { "cf-connecting-ip": ip() },
      }),
      db.env,
    );
    assert.equal(db.ran.length, 0);
  });
});
