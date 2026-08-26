# Penalty tuning log

Metric: eval/evaluate.mjs over eval/data/wikidata-tok.jsonl (8,498 Wikidata
entities, best rank across all language labels). Guardrail: npm test must
stay green (wiki-canon examples).

| # | change | top1 | top4 | top8 | dist | tests | verdict |
|---|--------|------|------|------|------|-------|---------|
| 0 | baseline (v1.2.0) | .271 | .376 | .387 | .307 | pass | — |
| 1 | dropConsonant -2.5 -> -2, epenthesis -1 -> -1.6 | .313 | .385 | .390 | .283 | pass | keep |
| 2 | dropConsonant -1.9, epenthesis -1.8 | .314 | .385 | .390 | .282 | pass | keep |
| 3 | hiatusDrop split from dropVowel, -1.05 | .299 | .386 | .390 | .289 | pass | revert value |
| 3b | hiatusDrop -1.5 | .314 | .386 | .390 | .282 | pass | keep |
| 4 | syllableOver3 -1.1 -> -1.5 | .300 | .385 | .390 | .288 | pass | revert |
| 5 | preconsonantal ng -> n (scripts.ts) | .316 | .386 | .390 | .281 | pass | keep |
| 6 | initialVowelDrop -1.75 (new beam option) | .316 | .386 | .390 | .281 | pass | keep (adds Mewika-class candidates, no cost) |
| 8 | dropCodaLiquid -1.2 (new: vocalize post-vocalic l/w) | .328 | .387 | .391 | .275 | pass | keep, biggest single win |
| 9 | dropCodaLiquid -0.9 | .328 | .387 | .391 | .275 | pass | revert to -1.2 (same result, less aggressive) |
| 7c | finalNasalClip -1.1 split from dropVowel | .328 | .387 | .391 | .275 | pass | keep (neutral, adds Pesin-class candidates) |
| 10 | eval/tune.mjs coordinate descent over all 15 weights | train +0.5pt | | | | pass | reject: holdout REGRESSED (.3197 -> .3169) |

## Unreachable-bucket reclaim (post-tuning)

Denominator changes here: the subset aligner made 386 more entities
scorable, so rates below aren't directly comparable to the table above.

| change | scored | top1 | top4 | unreachable |
|--------|--------|------|------|-------------|
| subset alignment in eval (extra source words may go unused) | 4886 | .362 | .427 | .569 |
| Devanagari support in scripts.ts (feature) | 4886 | .369 | .433 | .563 |
| kana aliases harvested (にほん -> Nijon now explainable) | 4900 | .371 | .436 | .560 |
| clean.mjs: dataset pruned to 4,805 clean entities, unreadable labels dropped | 4774 | .381 | .447 | .549 |

## Conclusions

- Baseline -> final: top1 .271 -> .328, dist .307 -> .275, all 45 tests green.
- The deletion-over-epenthesis rebalance (E1/E2) and coda-liquid
  vocalization (E8) carried nearly all the gain.
- Automated tuning (tune.mjs) confirms the weights are at a local optimum:
  every further gain it found on train failed to transfer to holdout.
  Remaining headroom is structural, not weights:
  - unreachable bucket (61%) is mostly endonym/romanization data gaps,
    out of scope per project decision;
  - genuine rule gaps left: community-inconsistent -ija clipping
    (Losi vs Italija), heavy clipping (Deutsch -> Tosi), vowel quality
    (English -> Inli needs e -> i).
