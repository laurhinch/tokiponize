---
"tokiponize": minor
---

Consonant clusters now lose a consonant before they gain a syllable, the
way the community reads them. `Christina` gives `Kisina` rather than
`Kiwisitina`, and `Flavor Foley` gives `Pajo Pole` rather than
`Palajo Pole`. Breaking a cluster with an echo vowel is still on the list,
since both readings are attested (`cricket` -> `Kilike`).

Top-1 accuracy against the Wikidata set goes .408 -> .446, top-8
.518 -> .595, measured on a holdout the weights were never tuned on.

`tokiponizeBest("Chris")` changes from `Kiwisi` to `Kisi`.
