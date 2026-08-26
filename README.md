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
