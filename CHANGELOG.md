# tokiponize

## 1.5.0

### Minor Changes

- b9f3d91: Consonant clusters now lose a consonant before they gain a syllable, the
  way the community reads them. `Christina` gives `Kisina` rather than
  `Kiwisitina`, and `Flavor Foley` gives `Pajo Pole` rather than
  `Palajo Pole`. Breaking a cluster with an echo vowel is still on the list,
  since both readings are attested (`cricket` -> `Kilike`).
  
  Top-1 accuracy against the Wikidata set goes .408 -> .446, top-8
  .518 -> .595, measured on a holdout the weights were never tuned on.
  
  `tokiponizeBest("Chris")` changes from `Kiwisi` to `Kisi`.

### Patch Changes

- 0d66819: Read Japanese long vowels as one sound: とうきょう is now Tokojo rather than "Tojujo", and the ー bar no longer doubles a vowel (シャーロット gives Saloto). The sh/ch/j kana rows also stop taking a stray glide, so しゃ is sha rather than "sja" and ジョン gives Son.
- 7b7f222: The site and the API take corrections. `POST /api/suggest` files the reading
  someone would have used instead, along with what the engine said at the time
  and where that reading sat in its list. Submissions are rate limited and
  checked against toki pona phonotactics, and nothing reaches `eval/` until
  someone has reviewed it. Nothing identifying is stored.
  
  There is also a queue: `GET /api/queue` hands out names other people have
  flagged without revealing what they suggested, `GET /api/queue?id=` reveals
  one, and `POST /api/vote` agrees or disagrees with it. The site asks for
  your own reading before showing you theirs, so the answers it collects are
  independent of the complaint they are judging. `?seen=` leaves out names
  already handed over, so a session can work through the whole queue, and a
  name retires from it once it has 20 answers and votes behind it.

## 1.4.0

### Minor Changes

- cc53c09: Convert each word of a name separately instead of running them together: "Anna Karenina" now gives "Ana Kawenina", not "Anakawenina".

### Patch Changes

- 740fccd: Read Greek digraphs as single sounds instead of letter by letter. `ου` is now u rather than "oi", `για` is ja rather than "kia", and `μπ`/`ντ` give b/d, so Γιάννης comes out as Janisi and Λουκάς as Lukasa. A diaeresis still keeps two vowels apart.
- 740fccd: Stop dropping the sound a name starts with. Christopher was coming out as "Witope" and Vladimir as "Lasimi"; they now keep their first consonant (Kiwitope, Walasimi).

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
