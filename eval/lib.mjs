// Shared evaluation machinery over eval/data/wikidata-tok.jsonl.

import { tokiponize, isValidName } from "../dist/index.js";

export const LIMIT = 8;

export function splitWords(label) {
  return label.split(/[\s\-]+/).filter(Boolean);
}

export function usableLabel(label) {
  return !/[()\[\]{}0-9/,.:;!?"&+*=@#%$]/.test(label);
}

export function capWords(tok) {
  return splitWords(tok).filter((w) => /^[A-Z]/.test(w));
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

let rankCache = new Map();
let evalOpts = {};

// call whenever penalty weights change
export function resetCache() {
  rankCache = new Map();
}

// extra tokiponize options for every rank() call, e.g. {experimental: true}
export function setEvalOpts(opts) {
  evalOpts = opts;
  resetCache();
}

// rank of the attested form among our candidates, -1 if absent
export function rank(source, attested) {
  const key = `${source} ${attested}`;
  if (rankCache.has(key)) return rankCache.get(key);
  const cands = tokiponize(source, { limit: LIMIT, ...evalOpts });
  const target = attested.toLowerCase();
  const r = cands.findIndex((c) => c.name.toLowerCase() === target);
  const out = { r, best: cands[0]?.name ?? "" };
  rankCache.set(key, out);
  return out;
}

// Pair each attested word with the unused source word that explains it
// best. Word order differs between source and toki pona, so no positional
// pairing.
export function alignPairs(label, attestedWords) {
  if (!usableLabel(label)) return null;
  const words = splitWords(label);
  if (attestedWords.length === 1 && words.length > 1 && !/\s/.test(label)) {
    return [[label, attestedWords[0]]];
  }
  // extra source words (Province, County) may go unused
  if (words.length < attestedWords.length || words.length > 6) return null;
  if (words.length === 1) return [[words[0], attestedWords[0]]];
  const used = new Set();
  const pairs = [];
  for (const att of attestedWords) {
    let pick = null;
    for (let w = 0; w < words.length; w++) {
      if (used.has(w)) continue;
      const { r, best } = rank(words[w], att);
      const dist = levenshtein(best.toLowerCase(), att.toLowerCase());
      const quality = (r === -1 ? 100 : r) * 100 + dist;
      if (!pick || quality < pick.quality) pick = { w, quality };
    }
    used.add(pick.w);
    pairs.push([words[pick.w], att]);
  }
  return pairs;
}

// worst per-word rank for one label, -1 if any word is unreachable
export function scoreLabel(label, attWords) {
  const pairs = alignPairs(label, attWords);
  if (!pairs) return null;
  let worst = 0;
  let dist = 0;
  const ours = [];
  for (const [src, att] of pairs) {
    const { r, best } = rank(src, att);
    ours.push(best);
    dist += levenshtein(best.toLowerCase(), att.toLowerCase()) /
      Math.max(best.length, att.length, 1);
    if (r === -1) worst = -1;
    else if (worst !== -1) worst = Math.max(worst, r);
  }
  return { worst, dist: dist / pairs.length, ours: ours.join(" ") };
}

// An entity counts by its best label: no source language is privileged.
export function evaluateRows(rows, { samples = false } = {}) {
  const stats = {
    entities: rows.length,
    noCapitalizedName: 0,
    invalidAttested: 0,
    noAlignableLabel: 0,
    scored: 0,
    top1: 0,
    top4: 0,
    top8: 0,
    unreachable: 0,
    distSum: 0,
    top1ByLang: {},
  };
  const notTop1 = [];
  const unreachable = [];

  for (const row of rows) {
    const attWords = capWords(row.tok);
    if (!attWords.length) {
      stats.noCapitalizedName++;
      continue;
    }
    if (!attWords.every((w) => isValidName(w))) {
      stats.invalidAttested++;
      continue;
    }

    let best = null;
    for (const [lang, label] of Object.entries(row.labels)) {
      const s = scoreLabel(label, attWords);
      if (!s) continue;
      s.lang = lang;
      s.label = label;
      const better = (a, b) =>
        (a.worst === -1 ? 100 : a.worst) - (b.worst === -1 ? 100 : b.worst) ||
        a.dist - b.dist;
      if (!best || better(s, best) < 0) best = s;
      if (best.worst === 0) break;
    }

    if (!best) {
      stats.noAlignableLabel++;
      continue;
    }
    stats.scored++;
    stats.distSum += best.dist;
    if (best.worst === 0) {
      stats.top1++;
      stats.top1ByLang[best.lang] = (stats.top1ByLang[best.lang] ?? 0) + 1;
    } else if (best.worst > 0 && best.worst < 4) {
      stats.top4++;
    } else if (best.worst > 0) {
      stats.top8++;
    }
    if (samples && best.worst > 0 && notTop1.length < 80) {
      notTop1.push({
        id: row.id,
        tok: row.tok,
        source: `${best.lang}:${best.label}`,
        rank: best.worst,
        ours: best.ours,
      });
    }
    if (best.worst === -1) {
      stats.unreachable++;
      if (samples && unreachable.length < 80) {
        unreachable.push({
          id: row.id,
          tok: row.tok,
          closest: `${best.lang}:${best.label}`,
          ours: best.ours,
        });
      }
    }
  }

  const scored = stats.scored || 1;
  const summary = {
    ...stats,
    top1Rate: +(stats.top1 / scored).toFixed(4),
    top4Rate: +((stats.top1 + stats.top4) / scored).toFixed(4),
    top8Rate: +((stats.top1 + stats.top4 + stats.top8) / scored).toFixed(4),
    unreachableRate: +(stats.unreachable / scored).toFixed(4),
    meanNormalizedDistance: +(stats.distSum / scored).toFixed(4),
  };
  delete summary.distSum;
  return { summary, notTop1, unreachable };
}
