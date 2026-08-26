// Read spelling into phonemes across several scripts, per
// sona.pona.la/wiki/Tokiponization. index.ts's PHONEME_TO_TP maps the
// resulting tokens to toki pona letters.

// Latin script

/** Letters NFD can't decompose safely, or whose base letter would mislead the rules below. Rewrite to an ASCII spelling those rules already handle. */
const SPECIAL_LATIN: Record<string, string> = {
  // Spanish/Czech palatal nasal
  "ñ": "ny",
  "ň": "ny",
  // cedilla forces /s/ regardless of the vowel after it
  "ç": "s",
  // German eszett
  "ß": "ss",
  // Nordic/German vowels with no decomposable diacritic
  "ø": "o",
  "æ": "a",
  "œ": "e",
  // Icelandic/Old English dental fricatives
  "ð": "th",
  "þ": "th",
  // Polish ł is /w/, not /l/
  "ł": "w",
  // carons mark an affricate/fricative, not the base consonant
  "č": "ch",
  "ć": "ch",
  "š": "sh",
  "ś": "sh",
  "ž": "sh",
  "ź": "sh",
  // Esperanto circumflex/breve letters
  "ĉ": "ch",
  "ĝ": "ch",
  "ĥ": "k",
  "ĵ": "sh",
  "ŝ": "sh",
  "ŭ": "w",
};

/** Spelling-to-phoneme digraphs, longest match first. Values are tokens, not toki pona letters. */
const DIGRAPHS: Array<[string, string[]]> = [
  // hard "ch" before a liquid is k, not s (Christopher, Chloe)
  ["chr", ["k", "rw"]],
  ["chl", ["k", "l"]],
  // one affricate, not a stop plus one (watch, bridge)
  ["tch", ["ch"]],
  ["dge", ["ch"]],
  ["sch", ["sh"]],
  ["ch", ["ch"]],
  ["sh", ["sh"]],
  // Polish digraphs SPECIAL_LATIN can't catch (no diacritics involved)
  ["cz", ["ch"]],
  ["rz", ["sh"]],
  ["sz", ["sh"]],
  ["dz", ["z"]],
  ["th", ["th"]],
  ["ph", ["f"]],
  ["ght", ["t"]],
  ["gh", []],
  ["ck", ["k"]],
  ["qu", ["k", "w"]],
  ["wr", ["rw"]],
  ["wh", ["w"]],
  ["kn", ["n"]],
  // eau is one vowel (bureau, chateau)
  ["eau", ["o"]],
  // gu before a front vowel keeps g hard and drops the u (guide, Miguel)
  ["gue", ["g", "e"]],
  ["gui", ["g", "i"]],
  // doubled vowels: real digraphs (oo, ee) or just gemination (Aaron)
  ["oo", ["u"]],
  ["ee", ["i"]],
  ["aa", ["a"]],
  ["ii", ["i"]],
  ["uu", ["u"]],
  ["ea", ["i"]],
  ["ai", ["e"]],
  ["ay", ["e"]],
  ["ey", ["e"]],
  ["ei", ["e"]],
  ["ie", ["i"]],
  ["au", ["o"]],
  ["aw", ["o"]],
  ["ou", ["u"]],
  ["ow", ["o"]],
  ["oa", ["o"]],
  ["oi", ["o"]],
  ["oy", ["o"]],
  ["ue", ["u"]],
  ["ui", ["u"]],
];

const BASE_LETTER: Record<string, string> = {
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  b: "b",
  d: "d",
  f: "f",
  h: "h",
  k: "k",
  l: "l",
  m: "m",
  n: "n",
  p: "p",
  s: "s",
  t: "t",
  v: "v",
  w: "w",
  z: "z",
  // default r to the English approximant (w), matching this table's other
  // English assumptions (th, ck, wh, ee, ...)
  r: "rw",
};

// English letter names, for initialisms read letter by letter (UK -> Juke)
const LETTER_NAMES: Record<string, string[]> = {
  a: ["e"], b: ["b", "i"], c: ["s", "i"], d: ["d", "i"], e: ["i"],
  f: ["e", "f"], g: ["ch", "i"], h: ["e", "ch"], i: ["a", "j"],
  j: ["ch", "e"], k: ["k", "e"], l: ["e", "l"], m: ["e", "m"],
  n: ["e", "n"], o: ["o"], p: ["p", "i"], q: ["k", "j", "u"],
  r: ["a", "rw"], s: ["e", "s"], t: ["t", "i"], u: ["j", "u"],
  v: ["w", "i"], w: ["w", "a"], x: ["e", "k", "s"], y: ["w", "a", "j"],
  z: ["s", "i"],
};

function latinTokens(raw: string): string[] {
  // short or vowelless all-caps reads as letter names, not as a word
  // (UK, USSR); pronounceable acronyms (NASA) still read as words
  if (/^[A-Z]{2,6}$/.test(raw) && (raw.length <= 3 || !/[AEIOU]/.test(raw))) {
    return raw.toLowerCase().split("").flatMap((ch) => LETTER_NAMES[ch]!);
  }
  let s = "";
  for (const ch of raw) s += SPECIAL_LATIN[ch.toLowerCase()] ?? ch;
  s = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  if (!s) return [];
  s = s.replace(/([^aeiou])\1+/g, "$1");

  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (
      s.startsWith("ng", i) &&
      (i + 2 === s.length || !/[aeiouy]/.test(s[i + 2]!))
    ) {
      tokens.push("ng");
      i += 2;
      continue;
    }
    const digraph = DIGRAPHS.find(([pat]) => s.startsWith(pat, i));
    if (digraph) {
      tokens.push(...digraph[1]);
      i += digraph[0].length;
      continue;
    }
    const ch = s[i]!;
    const next = s[i + 1];
    // treat soft c/g before a front vowel as fricative/affricate (city, giant)
    if (ch === "c") tokens.push(next && "eiy".includes(next) ? "s" : "k");
    else if (ch === "g") tokens.push(next && "eiy".includes(next) ? "ch" : "g");
    // default j to the glide /j/, the more common reading across languages, not English's /dʒ/
    else if (ch === "j") tokens.push("j");
    else if (ch === "q") tokens.push("k");
    else if (ch === "x") tokens.push("k", "s");
    // y is a consonant glide before a vowel, otherwise a vowel
    else if (ch === "y") {
      tokens.push(next && "aeiou".includes(next) ? "j" : "i");
    } else tokens.push(BASE_LETTER[ch] ?? "");
    i += 1;
  }
  // English final e after a consonant is silent more often than not (Kate,
  // Simone). Mark it so tokiponize can rank the clipped reading first while
  // keeping the pronounced one as an alternative.
  const last = tokens.length - 1;
  if (
    s.endsWith("e") && tokens[last] === "e" && last > 0 &&
    !"aeiou".includes(tokens[last - 1]!) &&
    tokens.slice(0, last).some((t) => "aeiou".includes(t))
  ) {
    tokens[last] = "e?";
  }
  return tokens;
}

// Cyrillic script

const CYRILLIC_TOKENS: Record<string, string[]> = {
  а: ["a"],
  б: ["b"],
  в: ["v"],
  г: ["g"],
  ґ: ["g"],
  д: ["d"],
  е: ["e"],
  ё: ["j", "o"],
  є: ["j", "e"],
  ж: ["sh"],
  з: ["z"],
  и: ["i"],
  і: ["i"],
  ї: ["j", "i"],
  й: ["j"],
  к: ["k"],
  л: ["l"],
  м: ["m"],
  н: ["n"],
  о: ["o"],
  п: ["p"],
  р: ["r"],
  с: ["s"],
  т: ["t"],
  у: ["u"],
  ф: ["f"],
  х: ["k"],
  ц: ["s"],
  ч: ["ch"],
  ш: ["sh"],
  щ: ["sh"],
  ъ: [],
  ы: ["i"],
  ь: [],
  э: ["e"],
  ю: ["j", "u"],
  я: ["j", "a"],
};

function cyrillicTokens(raw: string): string[] {
  const tokens: string[] = [];
  for (const ch of raw.toLowerCase()) {
    tokens.push(...(CYRILLIC_TOKENS[ch] ?? []));
  }
  return tokens;
}

// Greek script

const GREEK_TOKENS: Record<string, string[]> = {
  α: ["a"],
  ά: ["a"],
  β: ["v"],
  γ: ["g"],
  δ: ["th"],
  ε: ["e"],
  έ: ["e"],
  ζ: ["z"],
  η: ["i"],
  ή: ["i"],
  θ: ["th"],
  ι: ["i"],
  ί: ["i"],
  ϊ: ["i"],
  κ: ["k"],
  λ: ["l"],
  μ: ["m"],
  ν: ["n"],
  ξ: ["k", "s"],
  ο: ["o"],
  ό: ["o"],
  π: ["p"],
  ρ: ["r"],
  σ: ["s"],
  ς: ["s"],
  τ: ["t"],
  υ: ["i"],
  ύ: ["i"],
  φ: ["f"],
  χ: ["k"],
  ψ: ["p", "s"],
  ω: ["o"],
  ώ: ["o"],
};

function greekTokens(raw: string): string[] {
  const tokens: string[] = [];
  // polytonic marks decompose under NFD like Latin accents, so stripping
  // them reuses the modern table instead of needing a second one
  const plain = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const ch of plain) tokens.push(...(GREEK_TOKENS[ch] ?? []));
  return tokens;
}

// Korean Hangul

// 19 syllable-initial consonants, in Unicode jamo order.
const HANGUL_LEAD = [
  "g",
  "k", /* ㄲ */
  "n",
  "d",
  "t", /* ㄸ */
  "r",
  "m",
  "b",
  "p", /* ㅃ */
  "s",
  "s", /* ㅆ */
  "", /* ㅇ, null onset */
  "ch",
  "ch", /* ㅉ */
  "ch",
  "k",
  "t",
  "p",
  "h",
];

// 21 syllable vowels, in Unicode jamo order.
const HANGUL_VOWEL: string[][] = [
  ["a"],
  ["e"],
  ["j", "a"],
  ["j", "e"],
  ["o"], /* eo */
  ["e"],
  ["j", "o"], /* yeo */
  ["j", "e"],
  ["o"],
  ["w", "a"],
  ["w", "e"], /* wae */
  ["w", "e"], /* oe */
  ["j", "o"],
  ["u"],
  ["w", "o"], /* weo */
  ["w", "e"],
  ["w", "i"],
  ["j", "u"],
  ["u"], /* eu */
  ["u", "i"],
  ["i"],
];

// 28 syllable-final consonants (0 = none), collapsed to their neutralized
// coda sound
const HANGUL_TRAIL = [
  "",
  "k",
  "k",
  "k",
  "n",
  "n",
  "n",
  "t",
  "l",
  "k",
  "m",
  "l",
  "l",
  "l",
  "p",
  "l",
  "m",
  "p",
  "p",
  "t",
  "t",
  "n",
  "t",
  "t",
  "k",
  "t",
  "p",
  "t",
];

function hangulTokens(raw: string): string[] {
  const tokens: string[] = [];
  for (const ch of raw) {
    const s = ch.codePointAt(0)! - 0xac00;
    if (s < 0 || s > 11171) continue; // not a precomposed syllable block
    const lead = Math.floor(s / (21 * 28));
    const vowel = Math.floor((s % (21 * 28)) / 28);
    const trail = s % 28;
    if (HANGUL_LEAD[lead]) tokens.push(HANGUL_LEAD[lead]!);
    tokens.push(...HANGUL_VOWEL[vowel]!);
    if (HANGUL_TRAIL[trail]) tokens.push(HANGUL_TRAIL[trail]!);
  }
  return tokens;
}

// Japanese kana

const HIRAGANA_TOKENS: Record<string, string[]> = {
  "あ": ["a"],
  "い": ["i"],
  "う": ["u"],
  "え": ["e"],
  "お": ["o"],
  "か": ["k", "a"],
  "き": ["k", "i"],
  "く": ["k", "u"],
  "け": ["k", "e"],
  "こ": ["k", "o"],
  "が": ["g", "a"],
  "ぎ": ["g", "i"],
  "ぐ": ["g", "u"],
  "げ": ["g", "e"],
  "ご": ["g", "o"],
  "さ": ["s", "a"],
  "し": ["sh", "i"],
  "す": ["s", "u"],
  "せ": ["s", "e"],
  "そ": ["s", "o"],
  "ざ": ["z", "a"],
  "じ": ["z", "i"],
  "ず": ["z", "u"],
  "ぜ": ["z", "e"],
  "ぞ": ["z", "o"],
  "た": ["t", "a"],
  "ち": ["ch", "i"],
  "つ": ["s", "u"],
  "て": ["t", "e"],
  "と": ["t", "o"],
  "だ": ["d", "a"],
  "ぢ": ["z", "i"],
  "づ": ["z", "u"],
  "で": ["d", "e"],
  "ど": ["d", "o"],
  "な": ["n", "a"],
  "に": ["n", "i"],
  "ぬ": ["n", "u"],
  "ね": ["n", "e"],
  "の": ["n", "o"],
  "は": ["h", "a"],
  "ひ": ["h", "i"],
  "ふ": ["f", "u"],
  "へ": ["h", "e"],
  "ほ": ["h", "o"],
  "ば": ["b", "a"],
  "び": ["b", "i"],
  "ぶ": ["b", "u"],
  "べ": ["b", "e"],
  "ぼ": ["b", "o"],
  "ぱ": ["p", "a"],
  "ぴ": ["p", "i"],
  "ぷ": ["p", "u"],
  "ぺ": ["p", "e"],
  "ぽ": ["p", "o"],
  "ま": ["m", "a"],
  "み": ["m", "i"],
  "む": ["m", "u"],
  "め": ["m", "e"],
  "も": ["m", "o"],
  "や": ["j", "a"],
  "ゆ": ["j", "u"],
  "よ": ["j", "o"],
  "ら": ["r", "a"],
  "り": ["r", "i"],
  "る": ["r", "u"],
  "れ": ["r", "e"],
  "ろ": ["r", "o"],
  "わ": ["w", "a"],
  "ゐ": ["w", "i"],
  "ゑ": ["w", "e"],
  "を": ["o"],
  "ん": ["n"],
  "ゔ": ["v", "u"],
};

// derive katakana tokens from hiragana tokens
const KATAKANA_TOKENS: Record<string, string[]> = {};
for (const [k, v] of Object.entries(HIRAGANA_TOKENS)) {
  KATAKANA_TOKENS[String.fromCodePoint(k.codePointAt(0)! + 0x60)] = v;
}
const KANA_TOKENS: Record<string, string[]> = {
  ...HIRAGANA_TOKENS,
  ...KATAKANA_TOKENS,
};

const SMALL_YOON: Record<string, string> = { "ゃ": "a", "ゅ": "u", "ょ": "o" };
const SMALL_VOWEL: Record<string, string> = {
  "ぁ": "a",
  "ぃ": "i",
  "ぅ": "u",
  "ぇ": "e",
  "ぉ": "o",
};
for (const [k, v] of Object.entries({ ...SMALL_YOON })) {
  SMALL_YOON[String.fromCodePoint(k.codePointAt(0)! + 0x60)] = v;
}
for (const [k, v] of Object.entries({ ...SMALL_VOWEL })) {
  SMALL_VOWEL[String.fromCodePoint(k.codePointAt(0)! + 0x60)] = v;
}

function kanaTokens(raw: string): string[] {
  const chars = Array.from(raw);
  const tokens: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const entry = KANA_TOKENS[chars[i]!];
    if (!entry) {
      i += 1;
      continue;
    }
    const next = chars[i + 1];
    if (next && entry.length === 2) {
      if (SMALL_YOON[next] !== undefined) {
        tokens.push(entry[0]!, "j", SMALL_YOON[next]!);
        i += 2;
        continue;
      }
      if (SMALL_VOWEL[next] !== undefined) {
        tokens.push(entry[0]!, SMALL_VOWEL[next]!);
        i += 2;
        continue;
      }
    }
    if (
      next && entry.length === 1 && entry[0] === "u" &&
      SMALL_VOWEL[next] !== undefined
    ) {
      tokens.push("w", SMALL_VOWEL[next]!);
      i += 2;
      continue;
    }
    tokens.push(...entry);
    i += 1;
  }
  return tokens;
}

// Devanagari (Hindi, Nepali, Marathi, Sanskrit)
//
// Each consonant carries an inherent "a" unless a vowel sign (matra) or
// virama follows. Unicode stores matras after the consonant even when
// drawn before it, so one left-to-right pass works.

const DEVA_CONSONANT: Record<string, string> = {
  "क": "k",
  "ख": "k",
  "ग": "g",
  "घ": "g",
  "ङ": "n",
  "च": "ch",
  "छ": "ch",
  "ज": "ch",
  "झ": "ch",
  "ञ": "n",
  "ट": "t",
  "ठ": "t",
  "ड": "d",
  "ढ": "d",
  "ण": "n",
  "त": "t",
  "थ": "t",
  "द": "d",
  "ध": "d",
  "न": "n",
  "प": "p",
  "फ": "p",
  "ब": "b",
  "भ": "b",
  "म": "m",
  "य": "j",
  "र": "r",
  "ल": "l",
  "ळ": "l",
  "व": "w",
  "श": "sh",
  "ष": "sh",
  "स": "s",
  "ह": "h",
  // precomposed nukta forms (Persian/English loan sounds)
  "क़": "k",
  "ख़": "k",
  "ग़": "g",
  "ज़": "z",
  "ड़": "r",
  "ढ़": "r",
  "फ़": "f",
  "य़": "j",
};

// what the combining nukta turns these into
const DEVA_NUKTA: Record<string, string> = {
  "ड": "r",
  "ढ": "r",
  "ज": "z",
  "फ": "f",
  "क": "k",
  "ख": "k",
  "ग": "g",
};

const DEVA_VOWEL: Record<string, string[]> = {
  "अ": ["a"],
  "आ": ["a"],
  "इ": ["i"],
  "ई": ["i"],
  "उ": ["u"],
  "ऊ": ["u"],
  "ऋ": ["r", "i"],
  "ॠ": ["r", "i"],
  "ऌ": ["l", "i"],
  "ऍ": ["e"],
  "ऎ": ["e"],
  "ए": ["e"],
  "ऐ": ["a", "i"],
  "ऑ": ["o"],
  "ऒ": ["o"],
  "ओ": ["o"],
  "औ": ["a", "u"],
};

const DEVA_MATRA: Record<string, string[]> = {
  "ा": ["a"],
  "ि": ["i"],
  "ी": ["i"],
  "ु": ["u"],
  "ू": ["u"],
  "ृ": ["r", "i"],
  "ॄ": ["r", "i"],
  "ॅ": ["e"],
  "ॆ": ["e"],
  "े": ["e"],
  "ै": ["a", "i"],
  "ॉ": ["o"],
  "ॊ": ["o"],
  "ो": ["o"],
  "ौ": ["a", "u"],
};

function devanagariTokens(raw: string): string[] {
  const chars = Array.from(raw);
  const tokens: string[] = [];
  // consonant read but its inherent "a" not yet decided
  let pendingA = false;
  const flush = () => {
    if (pendingA) tokens.push("a");
    pendingA = false;
  };
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    let cons = DEVA_CONSONANT[ch];
    if (cons !== undefined) {
      flush();
      if (chars[i + 1] === "़") {
        cons = DEVA_NUKTA[ch] ?? cons;
        i += 1;
      }
      tokens.push(cons);
      pendingA = true;
    } else if (DEVA_MATRA[ch]) {
      tokens.push(...DEVA_MATRA[ch]!);
      pendingA = false;
    } else if (ch === "्") {
      // virama: bare consonant, no inherent vowel
      pendingA = false;
    } else if (DEVA_VOWEL[ch]) {
      flush();
      tokens.push(...DEVA_VOWEL[ch]!);
    } else if (ch === "ं" || ch === "ँ") {
      // anusvara nasalizes; n is the closest fit
      flush();
      tokens.push("n");
    } else {
      // visarga, digits, danda: not segmental, skip
      flush();
    }
    i += 1;
  }
  flush();
  return tokens;
}

type Script =
  | "latin"
  | "cyrillic"
  | "greek"
  | "hangul"
  | "kana"
  | "devanagari"
  | "other";

function classify(cp: number): Script {
  if (
    (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x300 && cp <= 0x36f)
  ) return "latin";
  if (cp >= 0x400 && cp <= 0x52f) return "cyrillic";
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) {
    return "greek";
  }
  if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff)) {
    return "hangul";
  }
  if (cp >= 0x3040 && cp <= 0x30ff) return "kana";
  if (cp >= 0x900 && cp <= 0x97f) return "devanagari";
  return "other";
}

/** Read raw text (any mix of the scripts above) into articulatory tokens. */
export function textToTokens(raw: string): string[] {
  const chars = Array.from(raw);
  const tokens: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const cls = classify(chars[i]!.codePointAt(0)!);
    let j = i + 1;
    while (j < chars.length && classify(chars[j]!.codePointAt(0)!) === cls) j++;
    const run = chars.slice(i, j).join("");
    switch (cls) {
      case "latin":
        tokens.push(...latinTokens(run));
        break;
      case "cyrillic":
        tokens.push(...cyrillicTokens(run));
        break;
      case "greek":
        tokens.push(...greekTokens(run));
        break;
      case "hangul":
        tokens.push(...hangulTokens(run));
        break;
      case "kana":
        tokens.push(...kanaTokens(run));
        break;
      case "devanagari":
        tokens.push(...devanagariTokens(run));
        break;
      case "other":
        break;
    }
    i = j;
  }
  return tokens;
}
