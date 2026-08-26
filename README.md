# tokiponize

Convert foreign names into phonotactically valid **toki pona**, with scored
alternatives. Usable as a library or from the command line!

```ts
import { tokiponize, tokiponizeBest, isValidName, syllabify } from "tokiponize";

tokiponizeBest("Lauren"); // "Lowen"
tokiponizeBest("Sam");    // "San"

tokiponize("Titan");
// [ { name: "Sitan", score: -0.25 }, { name: "Tetan", score: -0.75 }, ... ]

isValidName("Koti");    // false, *ti is forbidden
syllabify("sitelen");   // ["si", "te", "len"]
```

## Install

```sh
npm install -g tokiponize   # CLI
npm install tokiponize      # library
```

## CLI

```sh
tokiponize Lauren
# Lauren:
#   Lowen (0)
#   ...

tokiponize --best Titan Chris María
# Titan -> Sitan
# Chris -> Kiwisi
# María -> Mawija

tokiponize --json Sam
# {"name":"Sam","candidates":[{"name":"San","score":-0.4}, ...]}

tokiponize --check Koti
# Koti: not valid toki pona
```

Run `tokiponize --help` for the full flag list (`--limit`, `--best`, `--json`,
`--check`).

## How it works

Names are tokiponized in two steps:

1. Spelling is read into a phoneme (place, manner, voicing) per
   the [Tokiponization page](https://sona.pona.la/wiki/Tokiponization).
2. Phonemes get fit into toki pona's syllable scheme
   per the [Phonotactics page](https://sona.pona.la/wiki/Phonotactics):
   (C)V(n) syllables, forbidden `*wu`/`*wo`/`*ji`/`*ti`, no adjacent nasals. When a
   name doesn't fit well, or has multiple possible alternatives (echo vowels, dropped sounds,
   glides), they get scored and ranked instead of picking one answer for you.

Input isn't limited to plain English spelling, either! Accented Latin (`ñ`, `ç`,
`ø`, `ł`, ...), Cyrillic, Greek, Hangul, Japanese kana, and Devanagari are all
supported!

## Experimental learned model

`--experimental` (or `tokiponize(name, { experimental: true })`) blends in a
small transliteration model trained on attested community tokiponizations.
The rule engine still picks the top candidate; the model fills the rest of
the list with forms the rules never generate (Suomi -> `Sumi`, English ->
`Enli`). Expect its behavior to change between releases.

## Accuracy

Measured against tokiponizations the community actually uses: the
[toki pona labels on Wikidata](https://www.wikidata.org/) (language code
`tok`, CC0), ~4.8k entities harvested with the scripts in [`eval/`](eval/)
and kept in [`eval/data/wikidata-tok.jsonl`](eval/data/wikidata-tok.jsonl).
A name counts as matched when the attested form appears from *any* of the
entity's source-language labels. Held-out entities only, never trained or
tuned on:

| engine | top-1 | top-4 | top-8 | not generated |
|--------|-------|-------|-------|---------------|
| rules (default) | 37.9% | 44.2% | 44.6% | 55.4% |
| `--experimental` | 37.9% | 49.3% | 52.6% | 47.4% |

The gap to 100% is mostly names derived from endonyms or pronunciations no
written label provides (Japan -> `Nijon` needs "Nihon"): give it the source
the community used and it does far better than the table suggests.

## Limitations

Some letters and syllables are unfortunately ambiguous without knowing the source language.
A big one is `r`: Latin spelling defaults to the English (`w`), while Cyrillic, Greek, Hangul, and kana default to a
tap/trill (`l`), since those scripts are unambiguous about this case. A French or
German uvular `r` (which would ideally be `k`) reads as `w` too, since
there's no way to tell it apart from English by spelling alone. That's why
`tokiponize` returns several ranked candidates instead of just one.

If you find that this tool is not working as expected, please [open an issue](https://github.com/laurhinch/tokiponize/issues/new) or [submit a pull request](https://github.com/laurhinch/tokiponize/pulls).

## Development

```sh
npm install
npm test                 # compile and run the test suite
npm run build            # compile src/ to dist/ (what gets published)
npm run dev -- Lauren    # build and run the CLI in one step
```

## License

MIT
