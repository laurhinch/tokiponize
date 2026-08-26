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
`--check`, `--experimental`).

## API

`api/worker.mjs` is a small Cloudflare Worker wrapping the library, so any
tool that can fetch a URL can use it. No key, CORS open, 60 requests a
minute per IP.

```sh
curl "https://nimi.toki.li/api/tokiponize?name=Jakarta"
# {"name":"Jakarta","best":"Jakata","candidates":[{"name":"Jakata","score":-1.2}, ...]}

curl "https://nimi.toki.li/api/check?name=Koti"
# {"name":"Koti","valid":false,"syllables":null}
```

Both take `?name=`; `/tokiponize` also takes `&limit=` (max 8) and
`&experimental=1`. Deploy your own with:

```sh
npm run build && npx wrangler deploy -c api/wrangler.toml
```

It is a plain `fetch` handler, so it also runs on Deno Deploy, Vercel, and
Netlify with little change. JavaScript projects can skip the API and use
the package directly.

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

## Experimental mode

`--experimental` (or `tokiponize(name, { experimental: true })`) adds
suggestions from a small model trained on tokiponizations the community
actually uses. The rules still pick the top candidate; the model fills the
rest of the list with forms the rules never produce (Suomi -> `Sumi`,
English -> `Enli`). It may change between releases.

**This is not an LLM or generative AI.** The "model" is a ~3KB table of
letter-rewrite frequencies counted from real community examples, closer to
a spell-checker's statistics than to a chatbot. There's no neural network,
nothing runs remotely, and it can only ever output toki pona syllables.

## Accuracy

Tested against ~4,900 real tokiponizations, taken from the
[toki pona labels on Wikidata](https://www.wikidata.org/) (language code
`tok`, CC0) and kept in
[`eval/data/wikidata-tok.jsonl`](eval/data/wikidata-tok.jsonl). A name
counts as matched if any of that entity's source-language names produces
the community's form. Only names the tool was never tuned on:

| engine | top-1 | top-4 | top-8 | missed entirely |
|--------|-------|-------|-------|-----------------|
| rules (default) | 40.8% | 50.6% | 51.8% | 48.2% |
| `--experimental` | 40.8% | 54.5% | 57.4% | 42.6% |

Most misses are names the community based on what a place calls itself
(Japan -> `Nijon` comes from "Nihon"), which the written source doesn't
show. Start from the name the community used and it does much better. The
scripts behind these numbers live in [`eval/`](eval/).

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
