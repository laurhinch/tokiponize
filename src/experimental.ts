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

// the same split train-model.mjs counts under
const posOf = (start: number, end: number, len: number) =>
  start === 0 ? "i" : end === len ? "f" : "m";

const merged = new Map<string, Record<string, number> | undefined>();
function rewritesAt(s: string, pos: string) {
  const key = `${s}|${pos}`;
  if (merged.has(key)) return merged.get(key);
  const general = MODEL[s];
  const specific = MODEL[key];
  const out = general && specific
    ? { ...general, ...specific }
    : (specific ?? general);
  merged.set(key, out);
  return out;
}

const MAXT = 2;
const MISS = 8;

/** What the model charges to rewrite ph into name, or Infinity. */
export function alignCost(ph: string, name: string): number {
  const m = ph.length;
  const n = name.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
  dp[0]![0] = 0;
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      const cur = dp[i]![j]!;
      if (cur === Infinity) continue;
      for (let ls = 0; ls <= MAXS && i + ls <= m; ls++) {
        const rw = rewritesAt(ph.slice(i, i + ls), posOf(i, i + ls, m));
        for (let lt = 0; lt <= MAXT && j + lt <= n; lt++) {
          if (!ls && !lt) continue;
          const c = cur + (rw?.[name.slice(j, j + lt)] ?? MISS);
          if (c < dp[i + ls]![j + lt]!) dp[i + ls]![j + lt] = c;
        }
      }
    }
  }
  return dp[m]![n]!;
}

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
      // nothing gets inserted in front of a name's first sound
      const minLen = b.inserted || b.i === 0 ? 1 : 0;
      for (let ls = minLen; ls <= MAXS && b.i + ls <= ph.length; ls++) {
        const s = ph.slice(b.i, b.i + ls);
        const rewrites = rewritesAt(s, posOf(b.i, b.i + ls, ph.length));
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
