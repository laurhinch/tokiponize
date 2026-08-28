# Fold CMUdict's ARPAbet into the toki pona inventory, one "word phonemes"
# line per entry. eval/build-lexicon.mjs keeps the ones our rules get wrong.
#
#   pip install cmudict

import re
import sys

import cmudict

# voicing collapses, the rhotic goes to w as English speaks it, h drops
ARPA = {
    "AA": "a", "AE": "a", "AH": "a", "AO": "o", "AW": "aw", "AY": "aj",
    "EH": "e", "ER": "e", "EY": "e", "IH": "i", "IY": "i", "OW": "o",
    "OY": "oj", "UH": "u", "UW": "u",
    "B": "p", "CH": "s", "D": "t", "DH": "t", "F": "p", "G": "k", "HH": "",
    "JH": "s", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "n", "P": "p",
    "R": "w", "S": "s", "SH": "s", "T": "t", "TH": "s", "V": "w", "W": "w",
    "Y": "j", "Z": "s", "ZH": "s",
}


# ER carries the rhotic inside it, AH is the schwa. both read differently at
# the end of a word: Peru keeps its r and Christopher doesn't, Lauren has an
# e and Anna an a
FINAL = {"ER": "e", "AH": "a"}
MEDIAL = {"ER": "ew", "AH": "e"}


def fold(phones):
    bare = [re.sub(r"\d", "", p) for p in phones]
    out = ""
    for i, p in enumerate(bare):
        table = FINAL if i == len(bare) - 1 else MEDIAL
        out += table.get(p) or ARPA.get(p, "")
    # a doubled consonant is one sound, the same collapse the tokenizer does
    kept = []
    for ch in out:
        if kept and kept[-1] == ch and ch not in "aeiou":
            continue
        kept.append(ch)
    return "".join(kept)


def main():
    out = sys.stdout
    for word, prons in sorted(cmudict.dict().items()):
        # nothing tells us which variant to take, so take the first
        if not re.fullmatch(r"[a-z]{2,}", word):
            continue
        ph = fold(prons[0])
        if ph:
            out.write(f"{word} {ph}\n")


if __name__ == "__main__":
    main()
