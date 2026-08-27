// Coordinate-descent tuner for the PEN weights. Mutates PEN in place,
// optimizes top-1 on a training subsample, validates on a holdout.
// Test-suite canon examples are hard constraints.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PEN, tokiponize, tokiponizeBest } from "../dist/index.js";
import { evaluateRows, resetCache } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, "data", "wikidata-tok.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// deterministic split on the Q-id
const train = [];
const holdout = [];
for (const row of rows) {
  (Number(row.id.slice(1)) % 10 < 6 ? train : holdout).push(row);
}
const TRAIN_N = 2000;
const trainSample = train.filter((_, i) => i % Math.ceil(train.length / TRAIN_N) === 0);

const CANON_BEST = [
  ["Sonja", "Sonja"],
  ["Lauren", "Lowen"],
  ["Anna", "Ana"],
  ["Emma", "Ema"],
  ["Sam", "San"],
  ["guitar", "Kita"],
  ["Chris", "Kisi"],
  ["Zoe", "Sowe"],
  ["Wren", "Wen"],
  ["Telephone", "Telepon"],
  ["かね", "Kane"],
  ["たかはし", "Takasi"],
  ["さくら", "Sakula"],
  ["アリス", "Alisu"],
  ["クリス", "Kulisu"],
  ["김민준", "Kiminsun"],
  ["이서연", "Isojon"],
];
const CANON_MEMBER = [
  ["María", "Mawija"],
  ["Telephone", "Telepone"],
];

function canonOk() {
  for (const [src, want] of CANON_BEST) {
    if (tokiponizeBest(src) !== want) return false;
  }
  for (const [src, want] of CANON_MEMBER) {
    const names = tokiponize(src, { limit: 8 }).map((c) => c.name);
    if (!names.includes(want)) return false;
  }
  return true;
}

function objective(set) {
  const { summary: s } = evaluateRows(set);
  return {
    value: s.top1Rate + 0.3 * s.top4Rate - 0.1 * s.meanNormalizedDistance,
    summary: s,
  };
}

const PARAMS = Object.keys(PEN);
const LO = -3.5;
const HI = -0.05;

resetCache();
if (!canonOk()) {
  console.error("baseline violates canon, aborting");
  process.exit(1);
}
let best = objective(trainSample);
const holdoutBefore = objective(holdout).summary;
console.log("baseline PEN:", JSON.stringify(PEN));
console.log("train baseline:", best.value.toFixed(4), JSON.stringify(best.summary));
console.log("holdout baseline:", JSON.stringify(holdoutBefore));

let evals = 0;
for (const step of [0.4, 0.2, 0.1, 0.05]) {
  let improved = true;
  while (improved) {
    improved = false;
    for (const p of PARAMS) {
      const orig = PEN[p];
      for (const delta of [step, -step]) {
        const v = Math.min(HI, Math.max(LO, orig + delta));
        if (v === orig) continue;
        PEN[p] = v;
        resetCache();
        evals++;
        if (!canonOk()) {
          PEN[p] = orig;
          continue;
        }
        const cand = objective(trainSample);
        if (cand.value > best.value + 1e-6) {
          best = cand;
          console.log(
            `accept ${p}: ${orig} -> ${v} | train ${cand.value.toFixed(4)} ` +
              `(top1 ${cand.summary.top1Rate}) [eval ${evals}]`,
          );
          break;
        }
        PEN[p] = orig;
      }
    }
  }
  console.log(`step ${step} done after ${evals} evals`);
}

resetCache();
const holdoutAfter = objective(holdout).summary;
console.log("\ntuned PEN:", JSON.stringify(PEN, null, 2));
console.log("train final:", best.value.toFixed(4), JSON.stringify(best.summary));
console.log("holdout before:", JSON.stringify(holdoutBefore));
console.log("holdout after :", JSON.stringify(holdoutAfter));
writeFileSync(
  join(here, "data", "tuned-pen.json"),
  JSON.stringify({ pen: PEN, holdoutBefore, holdoutAfter }, null, 2),
);
