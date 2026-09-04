// The page and the built library are deployed by pages.yml as two halves of
// one thing: site/ with dist/ mounted at /lib. Nothing type-checks that
// seam, so a renamed export or a module left out of the copy takes the whole
// page down while every other test still passes. That is what happened in
// 9a1b7f0.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const at = (path: string) => fileURLToPath(new URL(path, ROOT));

const PAGE = readFileSync(at("site/index.html"), "utf8");

// pages.yml ships everything in dist/ except the CLI, which is node-only
const NOT_DEPLOYED = ["cli.js"];

// scripts/build-sitemap.mjs writes these into _site, so they are not on disk
const GENERATED = ["/names.html"];

/** the /lib/x.js the browser asks for is dist/x.js on disk */
const onDisk = (ref: string) =>
  ref.startsWith("lib/") ? at(`dist/${ref.slice(4)}`) : at(`site/${ref}`);

/** every static specifier in a module, relative ones still prefixed */
function specifiers(file: string): string[] {
  const src = readFileSync(at(`dist/${file}`), "utf8");
  return [...src.matchAll(/\bfrom\s*"([^"]+)"/g)].map((m) => m[1]);
}

if (!existsSync(at("dist/index.js"))) {
  throw new Error("dist/ is empty, run npm run build first");
}

describe("the page and the library it imports", () => {
  test("the module the page loads resolves in the deployed layout", () => {
    const match = PAGE.match(/import\("\.\/([^"]+)"\)/);
    assert.ok(match, "site/index.html no longer loads the library");
    assert.ok(
      existsSync(onDisk(match[1])),
      `the page loads ./${match[1]}, which the deploy does not produce`,
    );
  });

  test("every name the page uses is exported by the library", async () => {
    assert.ok(
      /import\("\.\/lib\/index\.js"\)/.test(PAGE),
      "site/index.html no longer loads ./lib/index.js",
    );
    const wanted = new Set(
      [...PAGE.matchAll(/\blib\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );
    assert.ok(wanted.size, "the page uses nothing off the module, which cannot be right");

    const lib = await import(pathToFileURL(at("dist/index.js")).href);
    for (const name of wanted) {
      assert.ok(
        name in lib,
        `the page uses lib.${name}, which dist/index.js does not export`,
      );
    }
  });

  test("the page does not block first paint on the library", () => {
    // english.js pulls in the 1.5MB lexicon, 482KB gzipped
    assert.ok(
      !/\bimport\s*\{[^}]*\}\s*from\s*"\.\/lib\//.test(PAGE),
      "site/index.html imports the library statically again, which puts the lexicon before first paint",
    );
  });

  test("the module graph the page pulls in is complete", () => {
    const seen = new Set<string>();
    const pending = ["index.js"];
    while (pending.length) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      assert.ok(
        existsSync(at(`dist/${file}`)),
        `${file} is imported but the build does not produce it`,
      );
      seen.add(file);
      for (const spec of specifiers(file)) {
        if (spec.startsWith("./")) pending.push(spec.slice(2));
      }
    }
    // the bug this file exists for: these three shipped missing
    for (const needed of ["drops.js", "english.js", "lexicon.js"]) {
      assert.ok(seen.has(needed), `${needed} left the graph, check pages.yml`);
    }
  });

  test("nothing the browser loads reaches for a node builtin", () => {
    const seen = new Set<string>();
    const pending = ["index.js"];
    while (pending.length) {
      const file = pending.pop() as string;
      if (seen.has(file) || !existsSync(at(`dist/${file}`))) continue;
      seen.add(file);
      for (const spec of specifiers(file)) {
        assert.ok(
          spec.startsWith("./"),
          `${file} imports "${spec}", which the browser cannot resolve`,
        );
        pending.push(spec.slice(2));
      }
    }
    for (const skipped of NOT_DEPLOYED) {
      assert.ok(
        !seen.has(skipped),
        `${skipped} is reachable from index.js but pages.yml drops it`,
      );
    }
  });
});

describe("files the deploy has to carry", () => {
  test("every local asset the page references exists", () => {
    const refs = new Set(
      [...PAGE.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((url) => !/^(https?:|data:|#|mailto:)/.test(url))
        .filter((url) => !GENERATED.includes(url)),
    );
    assert.ok(refs.size, "no local assets found, the scrape must have broken");
    for (const ref of refs) {
      assert.ok(existsSync(onDisk(ref)), `the page references ${ref}, which is missing`);
    }
  });

  test("the card the worker falls back to exists", () => {
    // worker.mjs redirects /og.png to ${SITE}/card.png when a name draws blank
    assert.ok(existsSync(at("site/card.png")), "site/card.png is missing");
  });

  test("the atlas the worker fetches is shipped and readable", () => {
    // og-card.mjs draws from this, and the worker reads it off the live site,
    // so it is the Pages deploy that has to put it there
    const atlas = JSON.parse(readFileSync(at("site/og-atlas.json"), "utf8"));
    for (const size of ["big", "small"]) {
      assert.ok(atlas[size], `the atlas has no ${size} font`);
      assert.ok(atlas[size].blob, `the ${size} font has no pixels`);
      assert.ok(
        Object.keys(atlas[size].glyphs ?? {}).length > 90,
        `the ${size} font is missing most of its glyphs`,
      );
    }
  });
});
