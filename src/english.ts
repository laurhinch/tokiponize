// English spelling doesn't tell you English sound, so the reading comes
// from a dictionary. whether th is /t/ or /θ/ is a fact about the word,
// Thomas against Anthony, and not something the letters say.

import { LEXICON } from "./lexicon.js";

let table: Map<string, string> | null = null;

function load(): Map<string, string> {
  const t = new Map<string, string>();
  for (const line of LEXICON.split("\n")) {
    const sp = line.indexOf(" ");
    t.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return t;
}

/** Latin letters with nothing added, which is how English writes. */
const PLAIN_ASCII = /^[A-Za-z]+$/;

/** How CMUdict says this word, in toki pona phonemes, or "". */
export function englishReading(raw: string): string {
  // a diacritic means it isn't English. María and Maria differ
  if (!PLAIN_ASCII.test(raw)) return "";
  table ??= load();
  return table.get(raw.toLowerCase()) ?? "";
}
