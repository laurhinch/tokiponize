#!/usr/bin/env node
import { isValidName, syllabify, tokiponize } from "./index.js";

const HELP = `\
tokiponize: convert foreign names into phonotactically valid toki pona

Usage:
  tokiponize <name> [<name> ...]     print candidates for each name
  tokiponize --check <name>          check if <name> is already valid toki pona
  cat names.txt | tokiponize -       read names, one per line, from stdin

Options:
  -n, --limit <n>    max candidates per name (default 4)
  -b, --best         print only the best candidate for each name
  -j, --json         print machine-readable JSON instead of text
  -c, --check        report whether the input is already a valid toki pona name
  -h, --help         show this help

Examples:
  tokiponize Lauren
  tokiponize --best Titan Chris María
  tokiponize --json Sam
  tokiponize --check Koti
`;

interface Args {
  names: string[];
  limit: number;
  best: boolean;
  json: boolean;
  check: boolean;
  help: boolean;
  stdin: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    names: [],
    limit: 4,
    best: false,
    json: false,
    check: false,
    help: false,
    stdin: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-b":
      case "--best":
        args.best = true;
        break;
      case "-j":
      case "--json":
        args.json = true;
        break;
      case "-c":
      case "--check":
        args.check = true;
        break;
      case "-n":
      case "--limit": {
        const v = argv[++i];
        if (v === undefined || Number.isNaN(Number(v))) {
          throw new Error(`--limit expects a number, got ${v ?? "nothing"}`);
        }
        args.limit = Number(v);
        break;
      }
      case "-":
        args.stdin = true;
        break;
      default:
        if (a.startsWith("-") && a !== "-") {
          throw new Error(`unknown flag: ${a}`);
        }
        args.names.push(a);
    }
  }
  return args;
}

async function readStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf-8");
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function printCheck(name: string, json: boolean): void {
  const valid = isValidName(name);
  if (json) {
    console.log(
      JSON.stringify({
        name,
        valid,
        syllables: valid ? syllabify(name) : null,
      }),
    );
    return;
  }
  console.log(
    valid
      ? `${name}: valid (${syllabify(name)!.join(".")})`
      : `${name}: not valid toki pona`,
  );
}

function printCandidates(
  name: string,
  limit: number,
  best: boolean,
  json: boolean,
): void {
  const candidates = tokiponize(name, { limit: best ? 1 : limit });
  if (json) {
    console.log(JSON.stringify({ name, candidates }));
    return;
  }
  if (!candidates.length) {
    console.log(`${name}: no valid candidates found`);
    return;
  }
  if (best) {
    console.log(`${name} -> ${candidates[0]!.name}`);
    return;
  }
  console.log(`${name}:`);
  for (const c of candidates) console.log(`  ${c.name} (${c.score})`);
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error(HELP);
    return 1;
  }

  if (args.help || (!args.names.length && !args.stdin)) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }

  const names = args.stdin
    ? [...args.names, ...(await readStdin())]
    : args.names;
  if (!names.length) {
    console.error("no names given");
    return 1;
  }

  for (const name of names) {
    if (args.check) printCheck(name, args.json);
    else printCandidates(name, args.limit, args.best, args.json);
  }
  return 0;
}

main().then((code) => process.exit(code));
