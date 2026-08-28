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

## Learned model (holdout only, Q-id % 10 >= 6, never trained on)

train-model.mjs learns substring rewrite costs from 2,918 aligned pairs
(train split only), decode in src/experimental.ts, opt-in via
`--experimental`. Hybrid interleaves rule and model candidates.

| engine | top1 | top4 | top8 | unreachable |
|--------|------|------|------|-------------|
| rules | .379 | .442 | .446 | .554 |
| model only | .364 | .476 | | .486 |
| hybrid (shipped) | .379 | .493 | .526 | .474 |

After the data expansion (49 label languages, aliases in 9 languages,
37.9k aliases, 4,879 clean entities):

| engine | top1 | top4 | top8 | unreachable |
|--------|------|------|------|-------------|
| rules | .400 | .466 | .470 | .530 |
| hybrid | .400 | .527 | .552 | .448 |

After back-porting model taste into the rules (latinRAsL -0.3,
finalAShift -0.55) plus letter-name reading for short/vowelless
all-caps initialisms (UK -> Juke):

| engine | top1 | top4 | top8 | unreachable |
|--------|------|------|------|-------------|
| rules | .408 | .506 | .518 | .482 |
| hybrid | .408 | .545 | .574 | .426 |

## Cluster reduction, a structural gap

The beam consumed phonemes strictly left to right, so a consonant followed
by another consonant had two moves: epenthesize it into its own syllable,
or drop it. "Keep this one as an onset and drop the next" was not on the
beam, which made the community's usual reading of a cluster unreachable
rather than low-ranked. Chris produced 16 candidates and Kisi was in none
of them. Flavor produced 12 and gave Palajo.

Splitting the eval on whether the source's phoneme string holds a cluster
shows where this cost us (English labels, single-word attested forms):

| source | n | top1 | top8 |
|--------|---|------|------|
| has a cluster | 1584 | .162 | .248 |
| no cluster | 1959 | .306 | .424 |

Clusters are 45% of the corpus and score about half as well.
`eval/cluster-slice.mjs` reproduces the split. After the change it reads
.199 / .328 against .309 / .428, and the misses left in the cluster bucket
are endonyms (France -> Kanse, Sweden -> Sensa), not rules.

PEN.clusterReduce prices a cluster member lost so its neighbour can stay
an onset, charged per consonant dropped. Swept on the train split and
confirmed on holdout, the same discipline that rejected the automated
tuner in row 10:

| clusterReduce | train top1 | hold top1 | hold top4 | hold unreach | hold dist |
|---------------|------------|-----------|-----------|--------------|-----------|
| off | .4155 | .4099 | .5253 | .4461 | .1786 |
| -2.2 | .4296 | .4216 | .5692 | .4058 | .1748 |
| -1.9 | .4317 | .4257 | .5712 | .4084 | .1745 |
| **-1.75** | **.4444** | **.4410** | **.5743** | .4079 | .1672 |
| -1.6 | .4434 | .4405 | .5717 | .4079 | .1677 |
| -1.4 | .4406 | .4390 | .5687 | .4099 | .1680 |

With the move on the beam, epenthesis is worth more than it was. Sweeping
it from -1.8 to -2 adds .0026 on holdout top1 and the curve is flat out to
-3.2, so it takes the least aggressive value that gets the gain. The
resulting order reads the way the wiki describes: finalDrop -0.75 <
clusterReduce -1.75 < dropConsonant -1.9 < epenthesis -2 < initialDrop -3.

Which member survives is left to the weights rather than fixed by a rule,
since the corpus attests both. Christmas Island -> Kisima and Christina
Rossetti -> Kisina keep the head; cricket -> Kilike and Crimea -> Kilin
break the cluster with an echo vowel. The canon example for Chris moved
from Kiwisi to Kisi on that evidence.

| engine | top1 | top4 | top8 | unreachable |
|--------|------|------|------|-------------|
| rules | .446 | .578 | .595 | .405 |
| hybrid | .446 | .590 | .620 | .380 |

## initialDrop, a deliberate loss

Cheaper consonant drops let word-initial sounds vanish: Christopher gave
"Witope", Vladimir "Lasimi". PEN.initialDrop (-3) prices dropping a sound
before anything has been emitted. Holdout top1 .408 -> .404, about seven
entities, and worth it: the corpus is mostly place names, while people's
names live or die on their first sound. A test pins the behavior.

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
- That call held up. Cluster reduction was one of those structural gaps,
  and adding the move rather than retuning around it took top1 .408 -> .446
  and cut the unreachable bucket by 7.7 points. Still open from that list:
  vowel quality, and metathesis (Lubnan -> Lunpan, not Lupan).

## Per-script reading quality

`evaluate.mjs` now breaks results down by the script the source is written
in. Counted only over labels that can reach the attested form at all, so
the number answers "when this label is the source the community used, do we
rank its reading first?" rather than punishing a language for having its
own word for Germany.

| script | labels | on source | ranked 1st | top4 |
|--------|--------|-----------|-----------|------|
| latin | 65198 | 13279 | .603 | .961 |
| devanagari | 2399 | 553 | .743 | .982 |
| greek | 2636 | 676 | .754 | .976 |
| cyrillic | 12015 | 2746 | .782 | .974 |
| hangul | 3005 | 503 | .783 | .976 |
| han | 53 | 12 | .833 | .917 |
| kana | 3977 | 878 | .875 | .987 |

Latin trails everything, which fits: it is the only script here where the
spelling does not tell you the sounds. Greek sat at the bottom before the
digraph fix; a stranger reported that, not this harness, which is why the
breakdown exists now.

## English comes from a dictionary

English spelling does not determine English sound. Whether `th` is /t/ or
/θ/ is a fact about the word, Thomas against Anthony, and no letter rule
recovers it. `eval/cmudict-fold.py` and `eval/build-lexicon.mjs` fold
CMUdict into the toki pona inventory offline and ship the 87k entries our
rules get wrong; a miss falls through to the rules.

The community used both readings: Malta by its letters, John by its sound.
The two usually tie on score, so the order the variants are tried in
decides it. Ties go to the spelling, which keeps every rank-1 answer the
rules already had and lets the dictionary only add candidates. Rank 1
unchanged, top 4 +65, unreachable -82. One line in `tokiponizeWord` to
reverse.

A word with a diacritic is skipped. CMUdict knows Maria, not María.

## What a dropped consonant costs

One flat penalty per position, same for every consonant, was wrong twice
over. Deletion rates from the training alignments:

| ph | initial | medial | final |
|----|---------|--------|-------|
| k | 3% | 11% | 79% |
| t | 5% | 13% | 86% |
| w | 3% | 39% | 83% |
| l | 1% | 18% | 60% |
| m | 1% | 5% | 9% |
| n | 1% | 3% | 1% |

A final k goes most of the time and a final n almost never, since toki pona
has an n coda to put it in. `eval/build-drops.mjs` writes these to
`src/drops.ts` and `dropScale` turns a rate into a cost. Final s deletes 78%
of the time, which undercut `finalSToSyllable` and turned Chris into Ki, so
that weight moved to .15.

## Rules rejected, and what rejected them

Check a spelling rule against the corpus before adding it. These lost:

| rule | colliding words |
|------|-----------------|
| dh silent | 143 (Albanian dhjetë, Sanskrit andhra, German gesundheit) |
| ao to i | 212 (tao, sao, saoudite) |
| medial ll to s | 1166 (estrella, csillag, yll) |
| initial ll to s | 44 (Catalan llac, llibre) |
| wy to u | 94 (Polish wyspa, nowy) |
| initial qi to s | 13, split 6 pinyin against 7 Azerbaijani |
| initial i before a vowel to j | 73 support it, Ian and Ioannis lose |

bh and mh went in without that check and cost 90 words: Bhutan read as
wutan, plus amharic, cumhuriyeti, treibhausgas. Word-final bh and mh have
no collisions, so the rule lives there now. The eval scored both the same,
so it cannot see this class of error.

## Two approaches that do not work

A syllable bigram model over the attested names, reranking rule candidates,
hurts monotonically: 54.3% at weight 0, 50.8% at 1, 42.4% at 3. Every rule
candidate is already legal toki pona, so a prior over what names look like
cannot separate them.

Reading a name under many languages does not work either. Across 17 epitran
Latin readers, no fixed reader beats the hand-written tokenizer (ours .385,
best alternative .399, French .464), and the per-name winner is scattered
with nothing to pick it by. Given each label's own language for free a real
G2P still loses: ours .3707, correct language .3758, generic-Latn .3681.
Correct is worse than generic because the community often reads a name by
its letters rather than by its source language's sound. Whatever IPA comes
out is collapsed into nine consonants and five vowels, where the precision
disappears.

Worth running as a bug finder though. Grouping the label words where a real
G2P clearly beat us turned up aw, ow, ay, ey and oy firing where the w or y
opens the next syllable: sarawak as /sawoak/, malawi as /maloi/, mayan as
/mean/. Fixing that was the largest single rule here.
