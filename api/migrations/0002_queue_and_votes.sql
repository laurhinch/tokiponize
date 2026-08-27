-- Votes and provenance for the queue on the site, where readers give their
-- own reading of a name someone else has flagged and then vote on the
-- reading that was filed for it.
--
--   up, down  tallies from that queue. No identity is stored anywhere here,
--             so these are rate limited rather than one-per-person.
--   via       'result' from the box under a result, 'queue' from the queue.
--             A queue row is a second opinion on a name someone else raised,
--             which is the strongest case for accepting it.

ALTER TABLE suggestions ADD COLUMN up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suggestions ADD COLUMN down INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suggestions ADD COLUMN via TEXT NOT NULL DEFAULT 'result';

-- the queue serves least-voted first, so it can stop scanning early
CREATE INDEX IF NOT EXISTS suggestions_queue
  ON suggestions (status, up, down);
