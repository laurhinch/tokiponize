// Pull reader-filed tokiponizations out of D1 and into eval/data.
//
//   node eval/export-suggestions.mjs --review     what still needs a look
//   node eval/export-suggestions.mjs              every row, with a fresh rank
//   node eval/export-suggestions.mjs --accepted   only the rows kept on review
//
// Reads D1 through wrangler, or a local file if SUGGESTIONS_DB is set, which
// is how to try this against the rows npm run site collects:
//
//   SUGGESTIONS_DB=.dev-suggestions.sqlite node eval/export-suggestions.mjs --review
//
// Needs wrangler logged in for the real thing. Nothing here feeds
// train-model.mjs. A public write endpoint wired to training data would
// train on whatever arrives, so accepting a row is a person's job. Mark
// them with:
//
//   npx wrangler d1 execute tokiponize-suggestions --remote \
//     --command "UPDATE suggestions SET status='accepted' WHERE id IN (1,2)"

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tokiponize } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const DB = "tokiponize-suggestions";
const review = process.argv.includes("--review");
const acceptedOnly = process.argv.includes("--accepted");

const local = process.env.SUGGESTIONS_DB;
const localDb = local
  ? new (await import("node:sqlite")).DatabaseSync(local, { readOnly: true })
  : null;

function query(sql) {
  if (localDb) return localDb.prepare(sql).all();
  const out = execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  // wrangler prints its own chatter before the JSON on some versions
  const start = out.indexOf("[");
  const parsed = JSON.parse(start > 0 ? out.slice(start) : out);
  return (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) ?? [];
}

// everything, so a complaint can be cross-referenced against the readings
// the queue collected for the same name
const all = query(
  `SELECT id, created, source, suggestion, ours, rank, engine, note, status, ` +
    `up, down, via FROM suggestions ORDER BY id`,
);

const rows = review
  ? all.filter((r) => r.status === "new" && r.via === "result")
  : acceptedOnly
  ? all.filter((r) => r.status === "accepted")
  : all;

if (!rows.length) {
  console.log("nothing to export");
  process.exit(0);
}

// readings the queue collected for the same name, blind to what was filed.
// one that matches independently is worth more than any number of votes.
for (const row of rows) {
  const answers = all.filter(
    (r) => r.via === "queue" && r.source === row.source,
  );
  row.agreed = answers.filter((r) => r.suggestion === row.suggestion).length;
  row.answered = answers.length;
  // the same count the queue retires a name on, at 20
  row.responses = row.up + row.down + row.answered;
}

// how the engine reads it today, so a row fixed since filing shows as fixed
for (const row of rows) {
  const cands = tokiponize(row.source, {
    limit: 8,
    experimental: row.engine === "experimental",
  });
  row.nowBest = cands[0]?.name ?? null;
  row.nowRank = cands.findIndex((c) => c.name === row.suggestion);
}

if (review) {
  // most answered first: those are the ones with enough behind them to call
  rows.sort((a, b) => b.responses - a.responses || a.id - b.id);
  console.log(`${rows.length} waiting`);
  console.log(
    "id    name -> filed          ours now    votes  blind agreement  note",
  );
  for (const r of rows) {
    const now = r.nowRank === -1 ? "(absent)" : `#${r.nowRank + 1}`;
    console.log(
      String(r.id).padEnd(6) +
        `${r.source} -> ${r.suggestion}`.padEnd(24) +
        `${r.ours} ${now}`.padEnd(14) +
        `${r.up}/${r.down}`.padEnd(7) +
        `${r.agreed}/${r.answered}`.padEnd(17) +
        (r.note ?? ""),
    );
  }
  process.exit(0);
}

const file = join(here, "data", "suggestions.jsonl");
writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const by = (key) =>
  Object.entries(
    rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {}),
  )
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");

console.log(`${rows.length} rows -> ${file}`);
console.log(`status: ${by("status")}`);
console.log(`engine: ${by("engine")}`);
console.log(`filed from: ${by("via")}`);
const absent = rows.filter((r) => r.rank === -1).length;
console.log(`filed forms we could not produce at all: ${absent}/${rows.length}`);
const fixed = rows.filter((r) => r.rank !== 0 && r.nowRank === 0).length;
console.log(`filed forms the engine now ranks first: ${fixed}/${rows.length}`);
