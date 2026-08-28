// Shared evaluation machinery over eval/data/wikidata-tok.jsonl.

import { tokiponize, isValidName } from "../dist/index.js";

export const LIMIT = 8;

export function splitWords(label) {
  return label.split(/[\s\-]+/).filter(Boolean);
}

export function usableLabel(label) {
  return !/[()\[\]{}0-9/,.:;!?"&+*=@#%$]/.test(label);
}

// toki pona's own vocabulary. a name sits next to a head noun (ma Kanse,
// toki Inli) and case is too unreliable to find the head by
const TP_WORDS = new Set(
  `a akesi ala alasa ale ali anpa ante anu awen e en esun ijo ike ilo insa jaki
jan jelo jo kala kalama kama kasi ken kepeken kili kiwen ko kon kule kulupu kute
la lape laso lawa len lete li lili linja lipu loje lon luka lukin lupa ma mama
mani meli mi mije moku moli monsi mu mun musi mute nanpa nasa nasin nena ni nimi
noka o olin ona open pakala pali palisa pan pana pi pilin pimeja pini pipi poka
poki pona pu sama seli selo seme sewi sijelo sike sin sina sinpin sitelen sona
soweli suli suno supa suwi tan taso tawa telo tenpo toki tomo tu unpa uta utala
walo wan waso wawa weka wile
namako kin oko kipisi leko monsuta tonsi jasima soko meso epiku kokosila lanpan
misikeke n su ku kijetesantakalu majuna`.split(/\s+/),
);

/** How close a label must read for a word to count as sourced. */
export const UNSOURCED_DIST = 0.6;
// ma lands inside the loose bound next to Mali by luck, so make a
// dictionary word earn its place
const TP_WORD_DIST = 0.25;

/** The words of an attested form that could be a name. Case is ignored. */
export function nameWords(tok) {
  return splitWords(tok)
    .map((w) => w.toLowerCase())
    .filter((w) => /^[a-z]+$/.test(w));
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
    noNameWord: 0,
    unsourced: 0,
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
    const attWords = nameWords(row.tok);
    if (!attWords.length) {
      if (row.tokRaw) stats.unsourced++;
      else stats.noNameWord++;
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

const SCRIPT_RANGES = [
  ["latin", 0x41, 0x24f],
  ["greek", 0x370, 0x3ff],
  ["cyrillic", 0x400, 0x52f],
  ["devanagari", 0x900, 0x97f],
  ["kana", 0x3040, 0x30ff],
  ["han", 0x4e00, 0x9fff],
  ["hangul", 0xac00, 0xd7a3],
];

/** the script most of a label is written in */
export function scriptOf(text) {
  const counts = {};
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const hit = SCRIPT_RANGES.find(([, lo, hi]) => cp >= lo && cp <= hi);
    if (hit) counts[hit[0]] = (counts[hit[0]] ?? 0) + 1;
  }
  let best = null;
  for (const [name, n] of Object.entries(counts)) {
    if (!best || n > best[1]) best = [name, n];
  }
  return best?.[0] ?? "other";
}

/**
 * Same scoring, but grouped by the script the source is written in rather
 * than best-label-wins, so one bad reader cannot hide behind the others.
 */
export function scriptBreakdown(rows) {
  const by = {};
  for (const row of rows) {
    const attWords = nameWords(row.tok);
    if (!attWords.length || !attWords.every((w) => isValidName(w))) continue;
    const seen = new Set();
    for (const label of Object.values(row.labels)) {
      if (seen.has(label)) continue;
      seen.add(label);
      const s = scoreLabel(label, attWords);
      if (!s) continue;
      const script = scriptOf(label);
      const b = (by[script] ??= { pairs: 0, top1: 0, top4: 0, unreachable: 0 });
      b.pairs++;
      if (s.worst === 0) b.top1++;
      else if (s.worst > 0 && s.worst < 4) b.top4++;
      else if (s.worst === -1) b.unreachable++;
    }
  }
  const out = {};
  for (const [script, b] of Object.entries(by)) {
    if (b.pairs < 30) continue;
    // most labels are simply a different name (every language has its own
    // word for Germany), so the honest question is: when this label IS the
    // source the community used, do we rank its reading first?
    const usable = b.pairs - b.unreachable;
    out[script] = {
      labels: b.pairs,
      onSource: usable,
      ranked1st: +(b.top1 / (usable || 1)).toFixed(3),
      top4: +((b.top1 + b.top4) / (usable || 1)).toFixed(3),
    };
  }
  return out;
}

// an attested word no label explains is a qualifier or a translation of
// the meaning, and belongs in neither the eval nor the training pairs
/** Attested words that some label word could plausibly have produced. */
export function sourcedWords(row, attWords, toPhonemes) {
  const sources = [];
  for (const label of Object.values(row.labels)) {
    if (!usableLabel(label)) continue;
    for (const w of splitWords(label)) {
      const ph = toPhonemes(w);
      if (ph) sources.push(ph);
    }
  }
  return attWords.filter((att) => {
    const target = att.toLowerCase();
    const bound = TP_WORDS.has(target) ? TP_WORD_DIST : UNSOURCED_DIST;
    return sources.some((ph) =>
      levenshtein(ph, target) / Math.max(ph.length, target.length) <= bound
    );
  });
}
