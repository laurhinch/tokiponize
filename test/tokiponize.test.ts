import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidName, syllabify, toPhonemes, tokiponize, tokiponizeBest } from "../src/index.js";

const SAMPLE_NAMES = [
  "Titan", "Lauren", "Chris", "Christopher", "Sonja", "María", "Sam", "David",
  "Kate", "Yuki", "Beth", "Ashley", "Smith", "Wolfgang", "Tim", "Zoe",
  "Taylor", "Emma", "Anna", "Woody", "Jill", "Quinn", "Xavier", "Björn",
  "Nguyen", "O'Brien", "Jean-Luc", "Александр", "李", "fjord", "Yvonne",
  // added while hunting for edge cases
  "Wednesday", "Knight", "Gnome", "Psalm", "Rhythm", "Sequoia", "Bureau",
  "Guillermo", "Miguel", "Guadalupe", "Squire", "Agnes", "Magnus",
  "Reginald", "Hypnosis", "Zzyzx", "Mississippi", "François", "Søren",
  "Łukasz", "Częstochowa", "Наталья", "Дмитрий", "Ὀδυσσεύς", "Ἀθήνα",
  "김민준", "이서연", "さくら", "ウィスキー", "ヴァイオリン",
  // a much larger sweep across common names, other scripts, and edge cases
  "James", "Robert", "William", "Richard", "Charles", "Patricia", "Elizabeth",
  "Barbara", "Jackson", "Sebastian", "Harper", "Scarlett", "Victoria", "Mark",
  "Josh", "Kurt", "Doug", "Ross", "Felix", "Marcus", "Justin", "Brian", "Dylan",
  "Bruce", "Trent", "Grant", "Frank", "Brooks", "Clark", "Floyd", "Christ",
  "Strand", "Splint", "Twist", "Crisp", "Blitz", "Renée", "Béatrice", "Jürgen",
  "Björk", "Rodrigo", "Javier", "Íñigo", "Alejandro", "Giulia", "Federico",
  "Niccolò", "João", "Cristiano", "Vincent", "Willem", "Zbigniew", "Grzegorz",
  "Wojciech", "Andrzej", "Aaliyah", "Isaiah", "Noor", "Zoë", "Raoul", "Reuben",
  "Samuel", "Manuel", "Rousseau", "Beau", "moon", "book", "food", "tree",
  "Владимир", "Екатерина", "Анастасия", "Виктор", "Ольга", "Иван", "Сергей",
  "Ελένη", "Δημήτριος", "Κωνσταντίνος", "Παναγιώτης", "Ευαγγελία",
  "박지훈", "최유진", "강수현", "임세영", "한지민", "오준서", "윤아름",
  "たなか", "やまもと", "すずき", "たかはし", "マイケル", "ジョン", "エミリー",
];

describe("validity", () => {
  test("every candidate for every sample name is phonotactically valid", () => {
    for (const name of SAMPLE_NAMES) {
      for (const c of tokiponize(name, { limit: 8 })) {
        assert.equal(isValidName(c.name), true);
        const lower = c.name.toLowerCase();
        assert.doesNotMatch(lower, /ti|ji|wo|wu/);
        assert.doesNotMatch(lower, /nn|nm/);
        assert.doesNotMatch(lower, /[aeiou][aeiou]/);
      }
    }
  });

  test("scores are sorted descending", () => {
    for (const name of SAMPLE_NAMES) {
      const cs = tokiponize(name, { limit: 8 });
      for (let i = 1; i < cs.length; i++) assert.ok(cs[i - 1]!.score >= cs[i]!.score);
    }
  });
});

describe("syllabify / isValidName", () => {
  test("accepts real toki pona words and names", () => {
    for (const w of ["toki", "pona", "sitelen", "kijetesantakalu", "Sonja", "Lolen", "linja", "anpa", "esun"]) {
      assert.equal(isValidName(w), true);
    }
  });

  test("rejects wuwojiti and other illegal shapes", () => {
    for (const w of ["Koti", "wuki", "wole", "jimi", "tinta", "anna", "anma", "kaa", "ptak", "sonj"]) {
      assert.equal(isValidName(w), false);
    }
  });

  test("syllabifies with coda n correctly", () => {
    assert.deepEqual(syllabify("sitelen"), ["si", "te", "len"]);
    assert.deepEqual(syllabify("anpa"), ["an", "pa"]);
    assert.deepEqual(syllabify("linja"), ["lin", "ja"]);
  });
});

describe("known tokiponizations", () => {
  test("Titan avoids *ti and offers both table alternatives", () => {
    const names = tokiponize("Titan", { limit: 8 }).map((c) => c.name);
    assert.ok(names.includes("Sitan"));
    assert.ok(names.includes("Tetan"));
    assert.ok(!names.includes("Titan"));
  });

  test("classic community results rank first", () => {
    assert.equal(tokiponizeBest("Sonja"), "Sonja");
    assert.equal(tokiponizeBest("Lauren"), "Lowen");
    assert.equal(tokiponizeBest("Anna"), "Ana");
    assert.equal(tokiponizeBest("Emma"), "Ema");
  });

  test("clusters break with echo vowels instead of vanishing", () => {
    assert.equal(tokiponizeBest("Chris").startsWith("Ki"), true);
    const chris = tokiponize("Chris", { limit: 8 }).map((c) => c.name);
    assert.ok(chris.includes("Kiwisi"));
  });

  test("glide insertion preserves vowel sequences", () => {
    const maria = tokiponize("María", { limit: 8 }).map((c) => c.name);
    assert.ok(maria.includes("Mawija"));
  });

  test("final m becomes a coda n", () => {
    assert.equal(tokiponizeBest("Sam"), "San");
  });

  test("a trailing consonant with no vowel to attach prefers dropping over adding a syllable", () => {
    assert.equal(tokiponizeBest("guitar"), "Kita");
    // trailing s is the exception: its echo syllable is still cheap enough to win
    assert.equal(tokiponizeBest("Chris"), "Kiwisi");
  });

  test("English silent final e: the clipped reading ranks first, the pronounced one stays an option", () => {
    const tel = tokiponize("telephone", { limit: 8 }).map((c) => c.name);
    assert.equal(tel[0], "Telepon");
    assert.ok(tel.includes("Telepone"));
    const simone = tokiponize("Simone", { limit: 8 }).map((c) => c.name);
    assert.equal(simone[0], "Simon");
    assert.ok(simone.includes("Simone"));
  });

  test("a final e stays pronounced when it isn't the English silent pattern", () => {
    // kana spell the vowel explicitly, so there is nothing to guess
    assert.equal(tokiponizeBest("かね"), "Kane");
    // a vowel before the final e means it's pronounced (Zoe, Chloe)
    assert.equal(tokiponizeBest("Zoe"), "Sowe");
  });

  test("a word-final nasal+vowel offers an n-coda alternative", () => {
    const simona = tokiponize("Simona", { limit: 8 }).map((c) => c.name);
    assert.equal(simona[0], "Simona");
    assert.ok(simona.includes("Simon"));
  });

  test("wu/wo starts use the alternatives table", () => {
    for (const c of tokiponize("Woody", { limit: 8 })) {
      assert.equal(c.name.toLowerCase().startsWith("wu"), false);
      assert.equal(c.name.toLowerCase().startsWith("wo"), false);
    }
  });

  test("non-latin input degrades gracefully", () => {
    assert.deepEqual(tokiponize("李"), []);
    assert.deepEqual(tokiponize("!!!"), []);
  });
});

describe("phonetic mapping (sona pona wiki: Tokiponization)", () => {
  test("labiodental fricatives split by voicing: f -> p, v -> w", () => {
    assert.equal(toPhonemes("Fifi"), "pipi");
    assert.equal(toPhonemes("Eva"), "ewa");
  });

  test("dental fricatives (th) devoice to t", () => {
    assert.equal(toPhonemes("Beth"), "pet");
    assert.equal(toPhonemes("Smith"), "smit");
  });

  test("affricates and postalveolar fricatives collapse to s", () => {
    assert.equal(toPhonemes("Chip"), "sip");
    assert.equal(toPhonemes("Shea"), "si");
  });

  test("silent letters before an English affricate digraph don't leave a stray stop", () => {
    // "watch" is /wɒtʃ/, one affricate, not /t/ plus /tʃ/
    assert.equal(toPhonemes("watch"), "was");
    // "bridge" is /brɪdʒ/, one affricate, and the trailing e is silent
    assert.equal(toPhonemes("bridge"), "pwis");
  });

  test("soft c/g before a front vowel join the fricative/affricate group", () => {
    assert.equal(toPhonemes("cent"), "sent");
    assert.equal(toPhonemes("change"), "sanse");
  });

  test("glottal h drops word-initially and leaves a hiatus mid-word for the syllabifier to resolve", () => {
    assert.equal(toPhonemes("Hugo"), "uko");
    assert.equal(toPhonemes("Noah"), "no");
  });

  test("standalone j stays the glide /j/, not assumed English /dʒ/", () => {
    assert.equal(toPhonemes("Jose"), "jose");
    assert.equal(tokiponizeBest("Sonja"), "Sonja");
  });

  test("accented and non-decomposing Latin letters map to their actual sound", () => {
    assert.equal(toPhonemes("François"), toPhonemes("Fransois")); // ç -> s
    assert.equal(toPhonemes("Søren"), "sowen"); // ø -> o, then written r -> w as usual
    assert.equal(toPhonemes("Łukasz"), "wukas"); // ł -> w; sz -> sh -> s
    assert.equal(toPhonemes("Müller"), "mulew"); // ü strips to its base vowel
  });

  test("silent u after gu before a front vowel keeps g hard", () => {
    assert.equal(toPhonemes("guitar"), "kitaw");
    assert.equal(toPhonemes("guide"), "kite");
    assert.equal(toPhonemes("Guillermo"), "kilewmo");
    assert.equal(toPhonemes("Miguel"), "mikel");
    // gu before a back vowel is a real /gw/, left to the existing glide insertion
    assert.equal(toPhonemes("Guadalupe"), "kuatalupe");
  });

  test('"eau" is one vowel, matching French loanword spelling', () => {
    assert.equal(toPhonemes("bureau"), "puwo");
    assert.equal(toPhonemes("chateau"), "sato");
  });

  test("a doubled vowel can be a digraph (moon, tree), not just gemination (Anna)", () => {
    // used to collapse to "mon"/"tre" before oo/ee could ever fire
    assert.equal(toPhonemes("moon"), "mun");
    assert.equal(toPhonemes("book"), "puk");
    assert.equal(toPhonemes("tree"), "twi");
    assert.equal(toPhonemes("feed"), "pit");
    // aa/ii/uu still collapse like doubled consonants
    assert.equal(toPhonemes("Aaron"), "awon");
    assert.equal(toPhonemes("Isaac"), "isak");
  });

  test("the same fix applies at the output stage too, across every script", () => {
    // h-drop used to leave two same vowels that silently collapsed, eating a mora
    assert.equal(toPhonemes("たかはし"), "takaasi");
    assert.equal(tokiponizeBest("たかはし"), "Takasi");
  });
});

describe("rhotic realization (r -> w, l, or k depending on source)", () => {
  test("Latin spelling defaults r to the English approximant (w)", () => {
    assert.equal(toPhonemes("Sara"), "sawa");
    assert.equal(toPhonemes("Robert"), "wopewt");
    assert.equal(tokiponizeBest("Lauren"), "Lowen");
    assert.equal(tokiponizeBest("Wren"), "Wen");
  });

  test("Cyrillic/Greek/Hangul/kana r is unambiguously a tap/trill, maps to l", () => {
    assert.equal(toPhonemes("Дмитрий"), "tmitlij");
    assert.equal(toPhonemes("Χριστόφορος"), "klistopolos");
    assert.equal(tokiponizeBest("さくら"), "Sakula");
  });

  test("French and Spanish r both read as the English default from bare Latin spelling", () => {
    assert.equal(toPhonemes("Pierre"), "piwe"); // French, ideally k
    assert.equal(toPhonemes("Rodrigo"), "wotwiko"); // Spanish, ideally l
  });
});

describe("names that keep clusters a silent-letter rule would wrongly drop", () => {
  test("gn/mn/pn are only silent word-initially, so no blanket digraph applies", () => {
    // guards a future blanket gn -> n "fix" from breaking these
    assert.equal(toPhonemes("Agnes"), "aknes");
    assert.equal(toPhonemes("Magnus"), "maknus");
    assert.equal(toPhonemes("Ignatius"), "iknatius");
    assert.equal(toPhonemes("Omnipotent"), "omnipotent");
    assert.equal(toPhonemes("Hypnosis"), "ipnosis");
  });
});

describe("robustness (never throws, degrades to \"\")", () => {
  test("empty, blank, and punctuation-only input", () => {
    for (const s of ["", "   ", "...", "123", "!!!", "'", "-", "---"]) {
      assert.equal(toPhonemes(s), "");
      assert.deepEqual(tokiponize(s), []);
    }
  });

  test("emoji and astral-plane characters are skipped like any other unrecognized script", () => {
    assert.equal(toPhonemes("😀"), "");
    assert.equal(toPhonemes("😀Chris😀"), toPhonemes("Chris"));
  });

  test("raw Hangul jamo (not a precomposed syllable) doesn't crash", () => {
    assert.equal(toPhonemes("ᄀᄁᄂ"), "");
    assert.equal(toPhonemes("ᅡᅢ"), "");
  });

  test("polytonic Greek diacritics resolve via NFD to their modern letter", () => {
    assert.equal(toPhonemes("Ἀθήνα"), "atina");
    assert.notEqual(toPhonemes("Ἀθήνα"), ""); // the leading vowel used to vanish entirely
  });

  test("a long run of alternating letters doesn't blow up the beam search", () => {
    const long = "ab".repeat(30);
    const start = process.hrtime.bigint();
    const result = tokiponize(long, { limit: 4 });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(result.length > 0);
    assert.ok(ms < 1000, `took ${ms}ms`);
  });
});

describe("Japanese kana: foreign-sound extensions with no dedicated kana", () => {
  test('bare u + a small vowel writes "w" plus that vowel', () => {
    assert.equal(toPhonemes("ウィスキー"), "wisuki");
    assert.equal(toPhonemes("ウェディング"), "wetinku");
    assert.equal(toPhonemes("ウォッチ"), "wosi");
  });

  test("vu (ヴ) plus a small vowel already had a consonant to combine with", () => {
    assert.equal(toPhonemes("ヴァイオリン"), "waiolin"); // violin
  });
});

describe("other scripts (sona pona wiki: Tokiponization)", () => {
  test("Cyrillic is read letter-by-letter, not dropped like other non-Latin input", () => {
    // Александр (Alexandr): а-л-е-к-с-а-н-д-р, р taps/trills like Latin r -> l
    assert.equal(toPhonemes("Александр"), "aleksantl");
    // Наталья (Natalya): ь is a silent palatalization marker, not a sound
    assert.equal(toPhonemes("Наталья"), "natalja");
  });

  test("Greek is read letter-by-letter using modern pronunciation", () => {
    // Χριστόφορος: the same "Christopher" shape as the Latin-script version
    assert.equal(toPhonemes("Χριστόφορος"), "klistopolos");
  });

  test("Greek digraphs are one sound, not two letters", () => {
    assert.equal(toPhonemes("ου"), "u"); // not o + i
    assert.equal(toPhonemes("αι"), "e");
    // γ before ι plus a vowel is a glide: για is ja, not kia
    assert.equal(toPhonemes("για"), "ja");
    assert.equal(tokiponizeBest("Γιάννης"), "Janisi");
    assert.equal(toPhonemes("Λουκάς"), "lukas");
    // μπ and ντ write b and d, which collapse to p and t
    assert.equal(toPhonemes("Μπάμπης"), "pampis");
    assert.equal(toPhonemes("Ντίνα"), "tina");
    // αυ takes an f before a voiceless sound, a v otherwise
    assert.equal(toPhonemes("αυτό"), "apto");
    assert.equal(toPhonemes("Εύα"), "ewa");
    // a diaeresis says the two vowels are separate
    assert.equal(toPhonemes("Αϊβαλί"), "aiwali");
  });

  test("Hangul syllables decompose algorithmically into lead/vowel/trailing jamo", () => {
    assert.equal(tokiponizeBest("김민준"), "Kiminsun"); // Kim Min-jun
    assert.equal(tokiponizeBest("이서연"), "Isojon"); // I Seo-yeon
  });

  test("a name keeps the sound it starts with", () => {
    for (const [name, initial] of [
      ["Christopher", "K"],
      ["Vladimir", "W"],
      ["Stephanie", "S"],
      ["Brooklyn", "P"],
    ]) {
      const got = tokiponizeBest(name!);
      assert.ok(got.startsWith(initial!), `${name} -> ${got}`);
    }
  });

  test("each word of a name converts on its own", () => {
    assert.equal(tokiponizeBest("Anna Karenina"), "Ana Kawenina");
    // every word of every candidate stays a valid name on its own
    for (const c of tokiponize("Ludwig van Beethoven", { limit: 4 })) {
      for (const word of c.name.split(" ")) assert.ok(isValidName(word), word);
    }
  });

  test("experimental model keeps the rule engine's top pick and only adds valid names", () => {
    for (const name of ["Lauren", "Suomi", "María"]) {
      const ruled = tokiponize(name)[0]!.name;
      const mixed = tokiponize(name, { experimental: true });
      assert.equal(mixed[0]!.name, ruled);
      for (const c of mixed) assert.ok(isValidName(c.name), c.name);
    }
  });

  test("Devanagari consonants carry an inherent a unless a matra or virama follows", () => {
    // भारत (Bhārat): the Wikidata-attested tokiponization of India is ma Palata
    assert.equal(tokiponizeBest("भारत"), "Palata");
    assert.equal(toPhonemes("नेपाल"), "nepala"); // Nepāl
    // हिन्दी (Hindī): the virama on न kills its inherent a
    assert.equal(toPhonemes("हिन्दी"), "inti");
    // मुंबई (Mumbaī): anusvara nasalizes, independent vowel restores the a
    assert.equal(toPhonemes("मुंबई"), "munpai");
  });

  test("kana long vowels collapse, and sh/ch/j take no glide", () => {
    // toki pona has no vowel length, so the second vowel goes
    assert.equal(toPhonemes("とうきょう"), "tokjo"); // Tokyo
    assert.equal(toPhonemes("おおさか"), "osaka"); // Osaka
    assert.equal(toPhonemes("ラーメン"), "lamen"); // the bar lengthens too
    // しゃ is sha, not s + y + a, but きゃ really is kya
    assert.equal(toPhonemes("シャーロット"), "saloto"); // Charlotte
    assert.equal(toPhonemes("きゃく"), "kjaku");
    assert.equal(tokiponizeBest("ジョン"), "Son"); // John
  });

  test("kana map cleanly since each character is already one CV syllable", () => {
    assert.equal(tokiponizeBest("さくら"), "Sakula"); // hiragana: Sakura
    assert.equal(tokiponizeBest("アリス"), "Alisu"); // katakana: Alice
    assert.equal(tokiponizeBest("クリス"), "Kulisu"); // katakana: Chris
  });

  test("small ゃゅょ palatalize the preceding kana instead of adding a syllable", () => {
    assert.equal(toPhonemes("きゃく"), toPhonemes("kjaku")); // kyaku, not kiyaku
  });

  test("Han ideographs carry no phonetic information and are skipped like punctuation", () => {
    assert.deepEqual(tokiponize("李"), []);
    // but a run of supported script alongside one is still read
    assert.equal(toPhonemes("María-李"), toPhonemes("María"));
  });
});
