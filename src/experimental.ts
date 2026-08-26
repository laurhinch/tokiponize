// Decode the phoneme string with rewrite costs learned from community
// tokiponizations. eval/train-model.mjs builds the model.

import { MODEL } from "./model.js";

interface Beam {
  i: number;
  out: string;
  score: number;
  inserted: boolean;
}

const WIDTH = 48;
const MAXS = 2;

/** Decode candidates, best first. Names come back lowercase and unvalidated. */
export function decode(ph: string, limit: number): Array<{ name: string; score: number }> {
  if (!ph) return [];
  let beams: Beam[] = [{ i: 0, out: "", score: 0, inserted: false }];
  const done: Beam[] = [];

  while (beams.length) {
    const next = new Map<string, Beam>();
    const push = (b: Beam) => {
      if (b.i === ph.length) {
        done.push(b);
        return;
      }
      const key = `${b.i}\t${b.out.slice(-2)}\t${b.inserted ? 1 : 0}`;
      const prev = next.get(key);
      if (!prev || b.score < prev.score) next.set(key, b);
    };

    for (const b of beams) {
      for (let ls = b.inserted ? 1 : 0; ls <= MAXS && b.i + ls <= ph.length; ls++) {
        const s = ph.slice(b.i, b.i + ls);
        const rewrites = MODEL[s];
        if (!rewrites) continue;
        for (const [t, c] of Object.entries(rewrites)) {
          if (!ls && !t) continue;
          push({
            i: b.i + ls,
            out: b.out + t,
            score: b.score + c,
            inserted: ls === 0,
          });
        }
      }
    }
    beams = [...next.values()].sort((a, b) => a.score - b.score).slice(0, WIDTH);
  }

  const seen = new Map<string, number>();
  for (const b of done) {
    const prev = seen.get(b.out);
    if (prev === undefined || b.score < prev) seen.set(b.out, b.score);
  }
  return [...seen.entries()]
    .map(([name, score]) => ({ name, score: -Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
