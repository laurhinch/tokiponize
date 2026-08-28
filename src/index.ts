// Converts names into toki pona phonotactics (rules: sona.pona.la/wiki/Phonotactics)
// and phonemes (rules: sona.pona.la/wiki/Tokiponization)

import { DROP } from "./drops.js";
import { englishReading } from "./english.js";
import { alignCost, decode } from "./experimental.js";
import { textToTokens } from "./scripts.js";

export interface Candidate {
  name: string;
  score: number;
}

export interface TokiponizeOptions {
  limit?: number;
  /** use the learned transliteration model instead of the rule engine */
  experimental?: boolean;
}

const CONSONANTS = new Set(["p", "t", "k", "s", "m", "n", "l", "j", "w"]);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Token -> toki pona phoneme, following the wiki's place/manner/voicing chart. */
const PHONEME_TO_TP: Record<string, string> = {
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  // final e latinTokens marked as probably silent; tokiponize handles the
  // clipped reading itself, this keeps toPhonemes complete
  "e?": "e",
  // nasals
  m: "m",
  n: "n",
  ng: "n",
  // plosives: place -> {p, t, k}, voicing collapses
  p: "p",
  b: "p",
  t: "t",
  d: "t",
  k: "k",
  g: "k",
  // labial fricatives keep their voicing distinction
  f: "p",
  v: "w",
  // dental fricatives (thin, this)
  th: "t",
  // alveolar/postalveolar fricatives and affricates all become s
  s: "s",
  z: "s",
  sh: "s",
  ch: "s",
  // glottal, dropped everywhere. mid-word this leaves a hiatus the
  // syllabifier already resolves with a glide
  h: "",
  // rhotic. "r" comes only from scripts with an unambiguous tap/trill
  // (Cyrillic, Greek, Hangul, kana). Latin emits "rw" instead, defaulting
  // to English's w: French uvular r (k) and Spanish trilled r (l) aren't
  // distinguishable from English by spelling alone.
  r: "l",
  rw: "w",
  l: "l",
  j: "j",
  w: "w",
};

function tokensToPhonemes(tokens: string[]): string {
  let out = "";
  for (const tok of tokens) out += PHONEME_TO_TP[tok] ?? "";
  // consonants only, same as scripts.ts: a doubled vowel here is real
  // hiatus for the syllabifier to resolve, not noise to erase
  return out.replace(/([^aeiou])\1+/g, "$1");
}

/** Read raw input into the toki pona phoneme inventory. */
export function toPhonemes(raw: string): string {
  return tokensToPhonemes(textToTokens(raw));
}

interface SylOption {
  syl: string;
  penalty: number;
}

/** Legal C+V options, substituting via the wuwojiti table when banned. */
function cvOptions(c: string, v: string, wordInitial: boolean): SylOption[] {
  if (c === "t" && v === "i") {
    return [
      { syl: "si", penalty: -0.25 },
      { syl: "te", penalty: -0.75 },
    ];
  }
  if (c === "j" && v === "i") {
    const opts: SylOption[] = [
      { syl: "je", penalty: -0.75 },
      { syl: "wi", penalty: -1 },
    ];
    if (wordInitial) opts.unshift({ syl: "i", penalty: -0.5 });
    return opts;
  }
  if (c === "w" && v === "o") {
    const opts: SylOption[] = [{ syl: "jo", penalty: -0.75 }];
    if (wordInitial) opts.unshift({ syl: "o", penalty: -0.5 });
    return opts;
  }
  if (c === "w" && v === "u") {
    const opts: SylOption[] = [
      { syl: "ju", penalty: -0.75 },
      { syl: "wa", penalty: -1.25 },
    ];
    if (wordInitial) opts.unshift({ syl: "u", penalty: -0.5 });
    return opts;
  }
  return [{ syl: c + v, penalty: 0 }];
}

interface State {
  i: number;
  syls: string[];
  score: number;
}

const BEAM_WIDTH = 40;

// swept on both splits, flat anywhere between .15 and .3
const FUSE_WEIGHT = 0.2;

// exported so eval tooling can adjust weights at runtime
export const PEN = {
  // turns a rate in drops.ts into a cost. cells it has no count for fall
  // through to the flat penalties below
  dropScale: -0.85,
  dropConsonant: -1.75,
  // a cluster member lost so its neighbour can stay an onset (Chris -> Kisi)
  clusterReduce: -1.75,
  dropCodaLiquid: -1.2,
  initialDrop: -3,
  // drop the word's last consonant cheaper than a mid-cluster one
  finalDrop: -0.75,
  dropVowel: -1.75,
  // second vowel of hiatus (Suomi -> Sumi)
  hiatusDrop: -1.9,
  sameVowel: -0.05,
  initialVowelDrop: -1.95,
  // word-final nasal+vowel to coda n (Pechino -> Pesin)
  finalNasalClip: -1.1,
  // Latin r read as a tap (Peru -> Pelu)
  latinRAsL: -0.3,
  // swapping the final vowel for a (Kanado -> Kanata)
  finalAShift: -1.15,
  // keeping a probably-silent English final e pronounced
  pronouncedFinalE: -0.1,
  epenthesis: -2.4,
  // keeping a later cluster member as the onset instead of the first
  clusterKeepLater: -0.8,
  // except before a stop, where the s is what goes
  clusterDropS: -0.4,
  // echo vowel copied backward from the syllable before
  echoBackward: -0.75,
  // echo vowel the spelling points at neither way
  echoOther: -0.6,
  glideNatural: -0.05,
  glideOther: -1.55,
  finalSToSyllable: -0.15,
  finalMToN: -0.4,
  nasalAssimilation: -0.3,
  syllableOver3: -0.7,
};

function lastVowelOf(syls: string[]): string {
  for (let k = syls.length - 1; k >= 0; k--) {
    const m = syls[k]!.match(/[aeiou]/g);
    if (m) return m[m.length - 1]!;
  }
  return "";
}

function nextVowelAhead(ph: string[], from: number): string {
  for (let k = from; k < ph.length; k++) if (VOWELS.has(ph[k]!)) return ph[k]!;
  return "";
}

function codaAllowed(ph: string[], nIndex: number, syls: string[]): boolean {
  if (!syls.length || syls[syls.length - 1]!.endsWith("n")) return false;
  const next = ph[nIndex + 1];
  if (next === undefined) return true;
  if (next === "n" || next === "m") return false;
  return !VOWELS.has(next);
}

function beamSearch(phStr: string, bias: number, done: State[]): void {
  const ph = [...phStr];
  let active: State[] = [{ i: 0, syls: [], score: bias }];

  while (active.length) {
    const nextActive: State[] = [];
    for (const st of active) {
      if (st.i >= ph.length) {
        if (st.syls.length) done.push(st);
        continue;
      }
      const ch = ph[st.i]!;
      const wordInitial = st.syls.length === 0;

      if (VOWELS.has(ch)) {
        if (wordInitial) {
          nextActive.push({ i: st.i + 1, syls: [ch], score: st.score });
          // America -> Mewika
          nextActive.push({
            i: st.i + 1,
            syls: [],
            score: st.score + PEN.initialVowelDrop,
          });
        } else {
          const prevV = lastVowelOf(st.syls);
          // insertion of glide keeps the vowel legal ex: Malia -> Malija.
          for (const g of ["j", "w"] as const) {
            const natural = (g === "j" && prevV === "i") ||
              (g === "w" && (prevV === "u" || prevV === "o"));
            for (const opt of cvOptions(g, ch, false)) {
              if (!CONSONANTS.has(opt.syl[0]!)) continue;
              nextActive.push({
                i: st.i + 1,
                syls: [...st.syls, opt.syl],
                score: st.score + opt.penalty +
                  (natural ? PEN.glideNatural : PEN.glideOther),
              });
            }
          }
          // a vowel repeated after itself is the same sound twice, usually
          // because a consonant between them dropped (Sahara -> Sawa).
          // merging costs nothing; a glide there would invent a syllable.
          nextActive.push({
            i: st.i + 1,
            syls: st.syls,
            score: st.score + (ch === prevV ? PEN.sameVowel : PEN.hiatusDrop),
          });
        }
        continue;
      }

      const next = ph[st.i + 1];
      if (next !== undefined && VOWELS.has(next)) {
        // Telephone -> Telepon alongside Telepone
        if (
          (ch === "n" || ch === "m") &&
          st.i + 2 === ph.length &&
          st.syls.length &&
          !st.syls[st.syls.length - 1]!.endsWith("n")
        ) {
          nextActive.push({
            i: st.i + 2,
            syls: [...st.syls.slice(0, -1), st.syls[st.syls.length - 1] + "n"],
            score: st.score + PEN.finalNasalClip +
              (ch === "m" ? PEN.finalMToN : 0),
          });
        }
        for (const opt of cvOptions(ch, next, wordInitial)) {
          const syls = [...st.syls, opt.syl];
          const base = { i: st.i + 2, syls, score: st.score + opt.penalty };
          if (ph[base.i] === "n" && codaAllowed(ph, base.i, syls)) {
            nextActive.push({
              i: base.i + 1,
              syls: [...syls.slice(0, -1), syls[syls.length - 1] + "n"],
              score: base.score,
            });
          }
          nextActive.push(base);
        }
        continue;
      }

      if (ch === "n" || ch === "m") {
        if (codaAllowed(ph, st.i, st.syls)) {
          nextActive.push({
            i: st.i + 1,
            syls: [...st.syls.slice(0, -1), st.syls[st.syls.length - 1] + "n"],
            score: st.score + (ch === "m" ? PEN.finalMToN : 0),
          });
        } else {
          nextActive.push({
            i: st.i + 1,
            syls: st.syls,
            score: st.score + PEN.nasalAssimilation,
          });
        }
        continue;
      }

      // keep one consonant as the onset and drop the rest of the cluster.
      // which one survives isn't always the first: Chris keeps its k, but
      // Christopher drops the s of st and keeps the t (Kitape, not Kisope)
      let vi = st.i + 1;
      while (vi < ph.length && !VOWELS.has(ph[vi]!)) vi++;
      if (vi < ph.length && vi > st.i + 1) {
        const lost = (vi - st.i - 1) * PEN.clusterReduce;
        for (let ci = st.i; ci < vi; ci++) {
        const order = ci === st.i
          ? 0
          : ch === "s" && ci === st.i + 1
          ? PEN.clusterDropS
          : PEN.clusterKeepLater;
        for (const opt of cvOptions(ph[ci]!, ph[vi]!, wordInitial)) {
          if (!CONSONANTS.has(opt.syl[0]!) && !wordInitial) continue;
          const syls = [...st.syls, opt.syl];
          const base = {
            i: vi + 1,
            syls,
            score: st.score + opt.penalty + lost + order,
          };
          if (ph[base.i] === "n" && codaAllowed(ph, base.i, syls)) {
            nextActive.push({
              i: base.i + 1,
              syls: [...syls.slice(0, -1), syls[syls.length - 1] + "n"],
              score: base.score,
            });
          }
          nextActive.push(base);
        }
        }
      }

      // break the cluster with an echo vowel (Chris -> Kilisi). nothing in
      // the spelling fixes which vowel, so offer several and let the score
      // pick (Polska -> Posuka)
      const ahead = nextVowelAhead(ph, st.i + 1);
      const behind = lastVowelOf(st.syls);
      const echoes = new Map<string, number>();
      const offer = (v: string, pen: number) => {
        if (!v) return;
        const prev = echoes.get(v);
        if (prev === undefined || pen > prev) echoes.set(v, pen);
      };
      // only charge for going against the spelling while there is one
      offer(ahead, 0);
      offer(behind, ahead ? PEN.echoBackward : 0);
      for (const v of ["u", "i", "a"]) {
        offer(v, ahead || behind ? PEN.echoOther : 0);
      }
      for (const [echo, echoPen] of echoes) {
      for (const opt of cvOptions(ch, echo, wordInitial)) {
        if (!CONSONANTS.has(opt.syl[0]!) && !wordInitial) continue;
        nextActive.push({
          i: st.i + 1,
          syls: [...st.syls, opt.syl],
          score: st.score + echoPen +
            opt.penalty +
            (next === undefined && ch === "s"
              ? PEN.finalSToSyllable
              : PEN.epenthesis),
        });
      }
      }
      // a liquid after a vowel drops cheaply, like non-rhotic r (Malta -> Mata)
      const codaLiquid = (ch === "l" || ch === "w") &&
        st.i > 0 &&
        VOWELS.has(ph[st.i - 1]!);
      // what a drop costs depends on the consonant and where it sits, so
      // the flat penalties are only a fallback. rates are in drops.ts
      const dropPos = st.i === 0 ? 0 : st.i === ph.length - 1 ? 2 : 1;
      const rate = DROP[ch]?.[dropPos];
      nextActive.push({
        i: st.i + 1,
        syls: st.syls,
        score: st.score +
          (rate != null
            ? PEN.dropScale * Math.log(1 / rate)
            : next === undefined
            ? PEN.finalDrop
            : !st.syls.length
            // losing the sound a name starts with is worse than losing
            // one in the middle (Christopher, not Witope)
            ? PEN.initialDrop
            : codaLiquid
            ? PEN.dropCodaLiquid
            : PEN.dropConsonant),
      });
    }

    nextActive.sort((a, b) => b.score - a.score);
    active = nextActive.slice(0, BEAM_WIDTH);
  }
}

function tokiponizeWord(
  raw: string,
  options: TokiponizeOptions = {},
): Candidate[] {
  const limit = options.limit ?? 4;
  const tokens = textToTokens(raw);
  const phStr = tokensToPhonemes(tokens);
  if (!phStr) return [];

  // a final e latinTokens marked probably-silent reads clipped by default,
  // with the pronounced form kept as a close alternative
  const variants: Array<{ ph: string; bias: number }> =
    tokens[tokens.length - 1] === "e?" && /[^aeiou]e$/.test(phStr)
      ? [
        { ph: phStr.slice(0, -1), bias: 0 },
        { ph: phStr, bias: PEN.pronouncedFinalE },
      ]
      : [{ ph: phStr, bias: 0 }];

  // the community used both readings, Malta by its letters and John by
  // its sound, so the dictionary competes level and goes last. ties fall
  // to the spelling
  const english = englishReading(raw);
  if (english && english !== phStr) variants.push({ ph: english, bias: 0 });

  // try Latin r as a tap too (Peru -> Pelu)
  if (tokens.includes("rw")) {
    const lStr = tokensToPhonemes(tokens.map((t) => (t === "rw" ? "l" : t)));
    for (const v of [...variants]) {
      const ph = v.ph.length === phStr.length ? lStr : lStr.slice(0, -1);
      variants.push({ ph, bias: v.bias + PEN.latinRAsL });
    }
  }

  const done: State[] = [];
  for (const v of variants) beamSearch(v.ph, v.bias, done);

  const seen = new Map<string, number>();
  for (const st of done) {
    const name = st.syls.join("");
    if (!name) continue;
    // nudge down long names
    const score = st.score +
      Math.max(0, st.syls.length - 3) * PEN.syllableOver3;
    const cased = name[0]!.toUpperCase() + name.slice(1);
    if (!isValidName(cased)) continue;
    const prev = seen.get(cased);
    if (prev === undefined || score > prev) seen.set(cased, score);
  }

  // the community likes names ending in a (Kanado -> Kanata)
  for (const [name, score] of [...seen.entries()]) {
    const last = name[name.length - 1]!;
    if (!"eiou".includes(last)) continue;
    const shifted = name.slice(0, -1) + "a";
    const s = score + PEN.finalAShift;
    if (!isValidName(shifted)) continue;
    const prev = seen.get(shifted);
    if (prev === undefined || s > prev) seen.set(shifted, s);
  }

  const byScore = [...seen.entries()]
    .map(([name, score]) => ({ name, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
  if (!options.experimental) return byScore.slice(0, limit);

  // the penalties and the model disagree usefully, so price a wider slice
  // under both and let the sum order them
  const pool = Math.max(limit * 2, 8);
  const fused: Candidate[] = [];
  for (const c of byScore.slice(0, pool)) {
    const cost = alignCost(phStr, c.name.toLowerCase());
    // no path through the model, so keep the rule score
    const score = Number.isFinite(cost) ? c.score - FUSE_WEIGHT * cost : c.score;
    fused.push({ name: c.name, score: Math.round(score * 100) / 100 });
  }
  fused.sort((a, b) => b.score - a.score);

  // names only the model reaches go after them
  const have = new Set(fused.map((c) => c.name));
  for (const c of decode(phStr, limit * 2)) {
    if (!c.name) continue;
    const name = c.name[0]!.toUpperCase() + c.name.slice(1);
    if (isValidName(name) && !have.has(name)) {
      have.add(name);
      fused.push({ name, score: c.score });
    }
  }
  return fused.slice(0, limit);
}

/** how many words a name may have before the rest is ignored */
const MAX_WORDS = 8;

/**
 * Tokiponize a name. Each word is converted on its own and the results
 * are recombined, so "Anna Karenina" gives "Ana Kawenina", not one word.
 */
export function tokiponize(
  raw: string,
  options: TokiponizeOptions = {},
): Candidate[] {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return tokiponizeWord(raw, options);

  const limit = options.limit ?? 4;
  let combos: Candidate[] = [{ name: "", score: 0 }];
  for (const word of words.slice(0, MAX_WORDS)) {
    const cands = tokiponizeWord(word, options);
    // a word with no reading at all (punctuation, han) just drops out
    if (!cands.length) continue;
    const next: Candidate[] = [];
    for (const combo of combos) {
      for (const c of cands) {
        next.push({
          name: combo.name ? `${combo.name} ${c.name}` : c.name,
          score: Math.round((combo.score + c.score) * 100) / 100,
        });
      }
    }
    next.sort((a, b) => b.score - a.score);
    combos = next.slice(0, limit * 4);
  }
  return combos[0]!.name ? combos.slice(0, limit) : [];
}

/** best single suggestion, or empty string. */
export function tokiponizeBest(raw: string): string {
  return tokiponize(raw, { limit: 1 })[0]?.name ?? "";
}

/** splits into toki pona syllables, or null if invalid. */
export function syllabify(name: string): string[] | null {
  const s = name.toLowerCase();
  if (!s || /[^aeioupktsmnljw]/.test(s)) return null;
  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < s.length) {
    let syl = "";
    const ch = s[i]!;
    if (CONSONANTS.has(ch)) {
      syl += ch;
      i++;
    } else if (!first) {
      return null; // null onset is word-initial only
    }
    const v = s[i];
    if (v === undefined || !VOWELS.has(v)) return null;
    syl += v;
    i++;
    if (syl === "ti" || syl === "ji" || syl === "wo" || syl === "wu") {
      return null;
    }
    if (s[i] === "n") {
      const after = s[i + 1];
      if (
        after === undefined ||
        (!VOWELS.has(after) && after !== "n" && after !== "m")
      ) {
        syl += "n";
        i++;
      } else if (after === "n" || after === "m") {
        return null; // adjacent nasals
      }
    }
    out.push(syl);
    first = false;
  }
  return out.length ? out : null;
}

export function isValidName(name: string): boolean {
  return syllabify(name) !== null;
}
