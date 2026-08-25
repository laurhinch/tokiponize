// Converts names into toki pona phonotactics (rules: sona.pona.la/wiki/Phonotactics)

export interface Candidate {
  name: string;
  score: number;
}

export interface TokiponizeOptions {
  limit?: number;
}

const CONSONANTS = new Set(["p", "t", "k", "s", "m", "n", "l", "j", "w"]);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

// English digraph rewrites
const GRAPHEMES: Array<[RegExp, string]> = [
  [/chr/g, "kr"],
  [/chl/g, "kl"],
  [/sch/g, "s"],
  [/ch/g, "s"],
  [/sh/g, "s"],
  [/th/g, "t"],
  [/ph/g, "p"],
  [/ght/g, "t"],
  [/gh/g, ""],
  [/ck/g, "k"],
  [/qu/g, "kw"],
  [/wr/g, "l"],
  [/wh/g, "w"],
  [/kn/g, "n"],
  [/ng$/g, "n"],
  [/x/g, "ks"],
  [/c(?=[eiy])/g, "s"],
  [/g(?=[eiy])/g, "j"],
  [/oo/g, "u"],
  [/ee/g, "i"],
  [/ea/g, "i"],
  [/ai/g, "e"],
  [/ay/g, "e"],
  [/ey/g, "e"],
  [/ei/g, "e"],
  [/ie/g, "i"],
  [/au/g, "o"],
  [/aw/g, "o"],
  [/ou/g, "u"],
  [/ow/g, "o"],
  [/oa/g, "o"],
  [/oi/g, "o"],
  [/oy/g, "o"],
  [/ue/g, "u"],
  [/ui/g, "u"],
];

const CHAR_MAP: Record<string, string> = {
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  b: "p",
  c: "k",
  d: "t",
  f: "p",
  g: "k",
  h: "",
  j: "j",
  k: "k",
  l: "l",
  m: "m",
  n: "n",
  p: "p",
  q: "k",
  r: "l",
  s: "s",
  t: "t",
  v: "w",
  w: "w",
  z: "s",
};

/** Normalize raw input into the toki pona phoneme inventory. */
export function toPhonemes(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s.replace(/(.)\1+/g, "$1");
  for (const [re, to] of GRAPHEMES) s = s.replace(re, to);
  // y is a consonant before a vowel, otherwise a vowel
  s = s.replace(/y(?=[aeiou])/g, "j").replace(/y/g, "i");
  let out = "";
  for (const ch of s) out += CHAR_MAP[ch] ?? "";
  return out.replace(/(.)\1+/g, "$1");
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

const PEN = {
  dropConsonant: -2.5,
  dropVowel: -1.75,
  epenthesis: -1,
  glideNatural: -0.4,
  glideOther: -1.25,
  finalSToSyllable: -0.5,
  finalMToN: -0.4,
  nasalAssimilation: -0.3,
  syllableOver3: -1.1,
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

/** Can a coda n attach here? Not before another nasal (no *nn / *nm). */
function codaAllowed(ph: string[], nIndex: number, syls: string[]): boolean {
  if (!syls.length || syls[syls.length - 1]!.endsWith("n")) return false;
  const next = ph[nIndex + 1];
  if (next === undefined) return true;
  if (next === "n" || next === "m") return false;
  return !VOWELS.has(next);
}

export function tokiponize(
  raw: string,
  options: TokiponizeOptions = {},
): Candidate[] {
  const limit = options.limit ?? 4;
  const phStr = toPhonemes(raw);
  if (!phStr) return [];
  const ph = [...phStr];

  let active: State[] = [{ i: 0, syls: [], score: 0 }];
  const done: State[] = [];

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
          nextActive.push({
            i: st.i + 1,
            syls: st.syls,
            score: st.score + PEN.dropVowel,
          });
        }
        continue;
      }

      const next = ph[st.i + 1];
      if (next !== undefined && VOWELS.has(next)) {
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

      // break the cluster with an echo vowel (Chris -> Kilisi).
      const echo = nextVowelAhead(ph, st.i + 1) || lastVowelOf(st.syls) || "a";
      for (const opt of cvOptions(ch, echo, wordInitial)) {
        if (!CONSONANTS.has(opt.syl[0]!) && !wordInitial) continue;
        nextActive.push({
          i: st.i + 1,
          syls: [...st.syls, opt.syl],
          score: st.score +
            opt.penalty +
            (next === undefined && ch === "s"
              ? PEN.finalSToSyllable
              : PEN.epenthesis),
        });
      }
      nextActive.push({
        i: st.i + 1,
        syls: st.syls,
        score: st.score + PEN.dropConsonant,
      });
    }

    nextActive.sort((a, b) => b.score - a.score);
    active = nextActive.slice(0, BEAM_WIDTH);
  }

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

  return [...seen.entries()]
    .map(([name, score]) => ({ name, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
