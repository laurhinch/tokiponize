# tokiponize

## 1.3.0

### Minor Changes

- c53befa: Devanagari support (भारत -> Palata), plus retuned penalties checked against thousands of real tokiponizations: dropping sounds now beats inserting vowels (España -> Epanja), l and r after a vowel can drop (Malta -> Mata), ng before a consonant reads as one nasal, and a name can shed its first vowel (America -> Mewika as an alternative).
- dc2781d: New `--experimental` flag (`{ experimental: true }` in the library): adds suggestions from a small model trained on real community tokiponizations. The rules keep the top pick. Not an LLM or generative AI: it is a ~3KB table of letter-rewrite frequencies, closer to a spell-checker's statistics than to a chatbot, and it runs entirely locally.
- 1099d05: Read short all-caps initialisms as letter names (UK -> Juke), try Latin r as l (Peru -> Pelu), and offer a final-a variant (Kanado -> Kanata).

## 1.2.0

### Minor Changes

- 0289383: Treat English word-final silent e as silent (Telephone -> Telepon), keeping the pronounced form as an alternative.

## 1.1.0

### Minor Changes

- Add phoneme-based tokiponization and script support.

## 1.0.0

### Major Changes

- Initial public release: name-to-toki-pona conversion library and CLI, distributed on npm for Node.
