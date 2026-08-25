import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidName, syllabify, tokiponize, tokiponizeBest } from "../src/index.js";

const SAMPLE_NAMES = [
  "Titan", "Lauren", "Chris", "Christopher", "Sonja", "María", "Sam", "David",
  "Kate", "Yuki", "Beth", "Ashley", "Smith", "Wolfgang", "Tim", "Zoe",
  "Taylor", "Emma", "Anna", "Woody", "Jill", "Quinn", "Xavier", "Björn",
  "Nguyen", "O'Brien", "Jean-Luc", "Александр", "李", "fjord", "Yvonne",
];

describe("validity", () => {
  test("every candidate for every sample name is phonotactically valid", () => {
    for (const name of SAMPLE_NAMES) {
      for (const c of tokiponize(name, { limit: 8 })) {
        assert.equal(isValidName(c.name), true);
        const lower = c.name.toLowerCase();
        assert.doesNotMatch(lower, /ti|ji|wo|wu/);
        assert.doesNotMatch(lower, /nn|nm/);
        assert.doesNotMatch(lower, /[aeiou][aeiou]/);
      }
    }
  });

  test("scores are sorted descending", () => {
    for (const name of SAMPLE_NAMES) {
      const cs = tokiponize(name, { limit: 8 });
      for (let i = 1; i < cs.length; i++) assert.ok(cs[i - 1]!.score >= cs[i]!.score);
    }
  });
});

describe("syllabify / isValidName", () => {
  test("accepts real toki pona words and names", () => {
    for (const w of ["toki", "pona", "sitelen", "kijetesantakalu", "Sonja", "Lolen", "linja", "anpa", "esun"]) {
      assert.equal(isValidName(w), true);
    }
  });

  test("rejects wuwojiti and other illegal shapes", () => {
    for (const w of ["Koti", "wuki", "wole", "jimi", "tinta", "anna", "anma", "kaa", "ptak", "sonj"]) {
      assert.equal(isValidName(w), false);
    }
  });

  test("syllabifies with coda n correctly", () => {
    assert.deepEqual(syllabify("sitelen"), ["si", "te", "len"]);
    assert.deepEqual(syllabify("anpa"), ["an", "pa"]);
    assert.deepEqual(syllabify("linja"), ["lin", "ja"]);
  });
});

describe("known tokiponizations", () => {
  test("Titan avoids *ti and offers both table alternatives", () => {
    const names = tokiponize("Titan", { limit: 8 }).map((c) => c.name);
    assert.ok(names.includes("Sitan"));
    assert.ok(names.includes("Tetan"));
    assert.ok(!names.includes("Titan"));
  });

  test("classic community results rank first", () => {
    assert.equal(tokiponizeBest("Sonja"), "Sonja");
    assert.equal(tokiponizeBest("Lauren"), "Lolen");
    assert.equal(tokiponizeBest("Anna"), "Ana");
    assert.equal(tokiponizeBest("Emma"), "Ema");
  });

  test("clusters break with echo vowels instead of vanishing", () => {
    assert.equal(tokiponizeBest("Chris").startsWith("Ki"), true);
    const chris = tokiponize("Chris", { limit: 8 }).map((c) => c.name);
    assert.ok(chris.includes("Kilisi"));
  });

  test("glide insertion preserves vowel sequences", () => {
    const maria = tokiponize("María", { limit: 8 }).map((c) => c.name);
    assert.ok(maria.includes("Malija"));
  });

  test("final m becomes a coda n", () => {
    assert.equal(tokiponizeBest("Sam"), "San");
  });

  test("wu/wo starts use the alternatives table", () => {
    for (const c of tokiponize("Woody", { limit: 8 })) {
      assert.equal(c.name.toLowerCase().startsWith("wu"), false);
      assert.equal(c.name.toLowerCase().startsWith("wo"), false);
    }
  });

  test("non-latin input degrades gracefully", () => {
    assert.deepEqual(tokiponize("李"), []);
    assert.deepEqual(tokiponize("!!!"), []);
  });
});
