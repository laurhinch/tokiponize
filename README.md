# tokiponize

Convert foreign names into phonotactically valid **toki pona**, with scored
alternatives. Usable as a library or from the command line!

```ts
import { tokiponize, tokiponizeBest, isValidName, syllabify } from "tokiponize";

tokiponizeBest("Lauren"); // "Lolen"
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
#   Lolen (-0.4)
#   ...

tokiponize --best Titan Chris María
# Titan -> Sitan
# Chris -> Kilisi
# María -> Malija

tokiponize --json Sam
# {"name":"Sam","candidates":[{"name":"San","score":-0.4}, ...]}

tokiponize --check Koti
# Koti: not valid toki pona

printf 'Titan\nChris\n' | tokiponize -
```

Run `tokiponize --help` for the full flag list (`--limit`, `--best`, `--json`,
`--check`).

## What it implements

The full phonotactics of toki pona, per the
[sona pona Phonotactics page](https://sona.pona.la/wiki/Phonotactics):

- (C)V(n) syllables
- No wu, wo, ji, ti
- No adjacent nasals: (`*anna -> ana`, `*anma -> ama`)

## Limitations

Tokiponization is partly aesthetic. The algorithm reads spelling, not
pronunciation, so names whose spelling and sound diverge heavily (English is
the usual offender) may need a human touch. That's why the API returns
several candidates instead of a single verdict, so you can treat them as suggestions.

## Development

```sh
npm install
npm test                 # compile and run the test suite
npm run build            # compile src/ to dist/ (what gets published)
npm run dev -- Lauren    # build and run the CLI in one step
```

## License

MIT
