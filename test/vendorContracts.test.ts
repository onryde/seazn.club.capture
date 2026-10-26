import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFiles, vendor } from '../scripts/vendor-contracts.mjs';

/**
 * `pnpm contracts:vendor` (plan D spec §3.1, owner ruling R7) against throwaway web checkouts: real git repositories
 * in the OS temp folder, never the web repo. The expected hashes are `shasum -a 256` of the literal bytes, worked out
 * by hand, never by the script.
 */
const SHA = {
  // printf '{"a":1}\n' | shasum -a 256
  a: 'e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c',
  // printf '{ "x":  1 }\n' | shasum -a 256
  valid: '5757bf015012fab52b466f6ca6ec214570e56fa1a58c09fbb389f95e6fc19954',
} as const;

type Files = Readonly<Record<string, string>>;
type Pins = { readonly web: string; readonly files: Files };

const WEB_FILES: Files = {
  'capture-a.v1.json': '{"a":1}\n',
  // Two spaces inside: a byte copy keeps them, where a JSON round trip or Prettier would not.
  'fixtures/capture-a.v1/valid.json': '{ "x":  1 }\n',
};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'capture-vendor-'));
  made.push(dir);
  return dir;
}

/** git with an identity and none of the machine's hooks or signing, so a commit never waits on anything. */
function git(dir: string, ...args: string[]): string {
  const config = [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
  ];
  return execFileSync('git', [...config, '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function commitAll(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'contracts');
}

/** A web checkout: `files` under docs/contracts and a README of the web's own outside it, committed. */
function webCheckout(files: Files = WEB_FILES): string {
  const dir = temp();
  git(dir, 'init', '-q');
  write(join(dir, 'docs', 'contracts'), files);
  write(dir, { 'README.md': 'the web\n' });
  commitAll(dir);
  return dir;
}

/** A contracts/ folder holding only our README, as this repo's does. */
function ourFolder(): string {
  const dir = temp();
  write(dir, { 'README.md': '# ours\n' });
  return dir;
}

const tree = (root: string): Files =>
  Object.fromEntries(listFiles(root).map((path) => [path, readFileSync(join(root, path), 'utf8')]));
const pins = (target: string): Pins =>
  JSON.parse(readFileSync(join(target, 'VENDORED.json'), 'utf8')) as Pins;
const contractsOf = (web: string) => join(web, 'docs', 'contracts');
const writeVendored = (target: string, text: string) =>
  writeFileSync(join(target, 'VENDORED.json'), text);

describe('pnpm contracts:vendor (plan D spec §3.1)', () => {
  it('copies docs/contracts byte for byte, keeps our README, and pins every file with the web commit', () => {
    const web = webCheckout();
    const target = ourFolder();
    const result = vendor(web, target);
    const head = git(web, 'rev-parse', 'HEAD');
    expect(listFiles(target)).toEqual([
      'README.md',
      'VENDORED.json',
      'capture-a.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
    expect(readFileSync(join(target, 'fixtures/capture-a.v1/valid.json'), 'utf8')).toBe(
      '{ "x":  1 }\n',
    );
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('# ours\n');
    expect(pins(target)).toEqual({
      web: head,
      files: { 'capture-a.v1.json': SHA.a, 'fixtures/capture-a.v1/valid.json': SHA.valid },
    });
    expect(result).toEqual({
      commit: head,
      added: ['capture-a.v1.json', 'fixtures/capture-a.v1/valid.json'],
      changed: [],
      removed: [],
    });
  });

  it('gives an identical tree on a second run, and reports nothing changed (a second call)', () => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    const first = tree(target);
    expect(vendor(web, target)).toEqual({
      commit: git(web, 'rev-parse', 'HEAD'),
      added: [],
      changed: [],
      removed: [],
    });
    expect(tree(target)).toEqual(first);
  });

  it('takes only the capture contracts: a web-only schema and its fixtures stay behind (relay-job, web f0feab16)', () => {
    const web = webCheckout({
      ...WEB_FILES,
      'relay-job.v1.json': '{"r":1}\n',
      'fixtures/relay-job.v1/valid.json': '{}\n',
      'fixtures/capture-a.v1/relay-job.v1.json': '{}\n',
    });
    const target = ourFolder();
    expect(vendor(web, target).added).toEqual([
      'capture-a.v1.json',
      'fixtures/capture-a.v1/relay-job.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
    expect(listFiles(target)).toEqual([
      'README.md',
      'VENDORED.json',
      'capture-a.v1.json',
      'fixtures/capture-a.v1/relay-job.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
  });

  it('refuses a web checkout that holds no capture contract, and touches nothing', () => {
    const web = webCheckout({ 'relay-job.v1.json': '{"r":1}\n' });
    const target = ourFolder();
    expect(() => vendor(web, target)).toThrow('no capture contract under docs/contracts');
    expect(listFiles(target)).toEqual(['README.md']);
  });

  it('follows the web: a changed file, an added one and a removed one, each reported, and no ghost left', () => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    write(contractsOf(web), {
      'capture-a.v1.json': '{"a":2}\n',
      'fixtures/capture-a.v1/invalid.json': '{}\n',
    });
    rmSync(join(contractsOf(web), 'fixtures', 'capture-a.v1', 'valid.json'));
    commitAll(web);
    expect(vendor(web, target)).toEqual({
      commit: git(web, 'rev-parse', 'HEAD'),
      added: ['fixtures/capture-a.v1/invalid.json'],
      changed: ['capture-a.v1.json'],
      removed: ['fixtures/capture-a.v1/valid.json'],
    });
    expect(listFiles(target)).toEqual([
      'README.md',
      'VENDORED.json',
      'capture-a.v1.json',
      'fixtures/capture-a.v1/invalid.json',
    ]);
    expect(Object.keys(pins(target).files)).toEqual([
      'capture-a.v1.json',
      'fixtures/capture-a.v1/invalid.json',
    ]);
  });

  // Each row vendors a good checkout first, so contracts/ holds files a run that deleted before refusing would lose.
  it.each([
    [
      'a tracked file changed and not committed',
      (web: string) => write(contractsOf(web), { 'capture-a.v1.json': '{"a":2}\n' }),
      /docs\/contracts is not clean/,
    ],
    [
      'an untracked file under docs/contracts',
      (web: string) => write(contractsOf(web), { 'fixtures/new.json': '{}\n' }),
      /docs\/contracts is not clean/,
    ],
    [
      'a README.md of the web’s own under docs/contracts',
      (web: string) => {
        write(contractsOf(web), { 'README.md': 'web\n' });
        commitAll(web);
      },
      /README\.md: those names are ours/,
    ],
    [
      'a docs/contracts git tracks nothing in',
      (web: string) => {
        git(web, 'rm', '-r', '-q', 'docs/contracts');
        git(web, 'commit', '-q', '-m', 'no contracts');
        mkdirSync(contractsOf(web), { recursive: true });
      },
      /git tracks nothing under docs\/contracts/,
    ],
    [
      'a folder with no docs/contracts (an empty input)',
      (web: string) => rmSync(contractsOf(web), { recursive: true, force: true }),
      /no docs\/contracts in /,
    ],
    [
      'a folder that is not a git checkout',
      (web: string) => rmSync(join(web, '.git'), { recursive: true, force: true }),
      /is not a git checkout/,
    ],
    // A VENDORED.json this script did not write (B1 review Minor 3): read, and refused, before contracts/ is rewritten.
    [
      'a VENDORED.json with no files',
      (_web: string, target: string) => writeVendored(target, '{"web":"x"}\n'),
      /VENDORED\.json is malformed/,
    ],
    [
      'a VENDORED.json whose files is null',
      (_web: string, target: string) => writeVendored(target, '{"web":"x","files":null}\n'),
      /VENDORED\.json is malformed/,
    ],
    [
      'a VENDORED.json whose files is a list',
      (_web: string, target: string) =>
        writeVendored(target, '{"web":"x","files":["capture-a.v1.json"]}\n'),
      /VENDORED\.json is malformed/,
    ],
    [
      'a VENDORED.json with a pin that is not text',
      (_web: string, target: string) =>
        writeVendored(target, '{"web":"x","files":{"capture-a.v1.json":1}}\n'),
      /VENDORED\.json is malformed/,
    ],
  ] as const)('refuses %s, and leaves contracts/ exactly as it was', (_why, spoil, message) => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    spoil(web, target);
    const before = tree(target);
    // Not vacuous: a vendored file the script removes before it copies is there to lose.
    expect(Object.keys(before)).toContain('capture-a.v1.json');
    expect(() => vendor(web, target)).toThrow(message);
    expect(tree(target)).toEqual(before);
  });

  it('vendors with untracked files elsewhere in the web checkout, as the owner’s has today (D-1)', () => {
    const web = webCheckout();
    write(web, { 'm1.txt': 'notes\n', '.claude/settings.json': '{}\n' });
    expect(vendor(web, ourFolder()).added).toEqual([
      'capture-a.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
  });

  it('never writes to the web checkout, not even git’s index refresh', () => {
    const web = webCheckout();
    // A tracked file's mtime moved and its bytes did not: a plain `git status` would refresh the index and rewrite it.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(contractsOf(web), 'capture-a.v1.json'), later, later);
    const index = join(web, '.git', 'index');
    const before = readFileSync(index);
    vendor(web, ourFolder());
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  it('lists files without Finder’s .DS_Store, at any depth, sorted', () => {
    const root = temp();
    write(root, {
      '.DS_Store': 'x',
      'fixtures/.DS_Store': 'x',
      'b.json': '{}',
      'a.json': '{}',
      'fixtures/c/d.json': '{}',
    });
    expect(listFiles(root)).toEqual(['a.json', 'b.json', 'fixtures/c/d.json']);
  });
});
