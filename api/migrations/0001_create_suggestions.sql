-- Reader-filed tokiponizations, written by /api/suggest in worker.mjs.
--
-- Applied by the Deploy Worker workflow, ahead of the worker that writes
-- to it. To run it by hand:
--
--   npx wrangler d1 migrations apply tokiponize-suggestions --remote
--     --config api/wrangler.toml
--
-- Nothing here identifies who filed a row. "ours" and "rank" are what the
-- engine said at the time, not what it says now. rank 0 is refused by the
-- endpoint unless it came from the queue, where agreeing with the tool is
-- an answer. rank -1 means the form was not in the list at all.

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  source TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  ours TEXT NOT NULL,
  rank INTEGER NOT NULL,
  engine TEXT NOT NULL,
  note TEXT,
  -- new until a human has looked: only accepted rows may reach eval/
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions (status, created);
-- for grouping the same name filed more than once
CREATE INDEX IF NOT EXISTS suggestions_source ON suggestions (source, suggestion);
