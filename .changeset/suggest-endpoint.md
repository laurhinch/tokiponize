---
"tokiponize": patch
---

The site and the API take corrections. `POST /api/suggest` files the reading
someone would have used instead, along with what the engine said at the time
and where that reading sat in its list. Submissions are rate limited and
checked against toki pona phonotactics, and nothing reaches `eval/` until
someone has reviewed it. Nothing identifying is stored.

There is also a queue: `GET /api/queue` hands out names other people have
flagged without revealing what they suggested, `GET /api/queue?id=` reveals
one, and `POST /api/vote` agrees or disagrees with it. The site asks for
your own reading before showing you theirs, so the answers it collects are
independent of the complaint they are judging. `?seen=` leaves out names
already handed over, so a session can work through the whole queue, and a
name retires from it once it has 20 answers and votes behind it.
