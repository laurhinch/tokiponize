---
"tokiponize": minor
---

New `--experimental` flag (`{ experimental: true }` in the library): adds suggestions from a small model trained on real community tokiponizations. The rules keep the top pick. Not an LLM or generative AI: it is a ~3KB table of letter-rewrite frequencies, closer to a spell-checker's statistics than to a chatbot, and it runs entirely locally.
