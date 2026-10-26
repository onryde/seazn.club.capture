// `pnpm contracts:vendor <path-to-web-checkout>` (plan D spec §3.1, owner ruling R7: pin only).
//
// Copies the capture contracts git tracks under the web checkout's docs/contracts (`capture-*` and
// `fixtures/capture-*`), byte for byte, into this repo's contracts/,
// and writes contracts/VENDORED.json: the web commit and the sha256 of every file copied. Run by hand, never in CI.
// It only READS the web checkout: every git call runs with --no-optional-locks, so not even git's index refresh
// writes there. Afterwards, copy the web's schema pins and its commit into test/contractPins.test.ts BY HAND, so a
// re-vendor can never move both sides of the pin at once.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'docs/contracts';

/** Ours, never the web's: kept by every run, and pinned by nothing. */
export const OURS = Object.freeze(['README.md', 'VENDORED.json']);

/**
 * The phone's contracts: a `capture-*` schema at the top, and the fixtures under `fixtures/capture-*`. The web keeps
 * other services' contracts beside them (relay-job.v1, the compositor's, since web 52806a00b); the phone pins the
 * same six capture schemas the web pins, so those stay behind.
 */
const CAPTURE = /^(capture-[^/]+|fixtures\/capture-[^/]+\/.+)$/;

/** Finder's folder metadata (.gitignore ignores it too): never a contract, so never listed. */
const IGNORED = new Set(['.DS_Store']);

/**
 * Every file under `root`, as posix paths relative to it, sorted, Finder's metadata left out.
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function listFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      if (IGNORED.has(entry.name)) return [];
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listFiles(root, path) : [path];
    })
    .sort();
}

/**
 * The sha256 of a file's bytes, as `shasum -a 256` prints it.
 * @param {string} file
 * @returns {string}
 */
export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * @param {string} web
 * @param {...string} args
 * @returns {string}
 */
function git(web, ...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', web, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The files to copy, relative to docs/contracts, after every check, so a refused run touches nothing: `web` holds a
 * docs/contracts, is a git checkout, its docs/contracts is clean (no uncommitted change, no untracked file), and
 * nothing there takes one of OUR names. Untracked files elsewhere in the web checkout do not matter (plan D1, D-1).
 * @param {string} web
 * @returns {string[]}
 */
function trackedContracts(web) {
  if (!existsSync(join(web, SOURCE))) throw new Error(`no ${SOURCE} in ${web}`);
  let dirty;
  try {
    dirty = git(web, 'status', '--porcelain', '--untracked-files=all', '--', SOURCE);
  } catch {
    throw new Error(`${web} is not a git checkout`);
  }
  if (dirty.trim() !== '') throw new Error(`${SOURCE} is not clean in ${web}:\n${dirty}`);
  const files = git(web, 'ls-files', '-z', '--', SOURCE)
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => path.slice(SOURCE.length + 1))
    .sort();
  if (files.length === 0) throw new Error(`git tracks nothing under ${SOURCE} in ${web}`);
  const clash = files.filter((path) => OURS.includes(path));
  if (clash.length > 0) {
    throw new Error(
      `${SOURCE} holds ${clash.join(', ')}: those names are ours (contracts/), refusing to overwrite`,
    );
  }
  const capture = files.filter((path) => CAPTURE.test(path));
  if (capture.length === 0) throw new Error(`no capture contract under ${SOURCE} in ${web}`);
  return capture;
}

/**
 * The pins the last run recorded, path to sha256, or none before the first run. A VENDORED.json whose `files` is not
 * that map was not written by this script, and is refused before anything in `target` is touched.
 * @param {string} target
 * @returns {Record<string, string>}
 */
function readPins(target) {
  const file = join(target, 'VENDORED.json');
  if (!existsSync(file)) return {};
  const files = JSON.parse(readFileSync(file, 'utf8'))?.files;
  const map = typeof files === 'object' && files !== null && !Array.isArray(files);
  if (!map || !Object.values(files).every((pin) => typeof pin === 'string')) {
    throw new Error(
      `${file} is malformed: its files must map each path to its sha256, refusing to vendor`,
    );
  }
  return files;
}

/**
 * Vendors `web`'s docs/contracts into `target`. Everything is checked before anything in `target` is removed.
 * @param {string} web a web checkout, only ever read
 * @param {string} target this repo's contracts/ folder
 * @returns {{ commit: string, added: string[], changed: string[], removed: string[] }}
 */
export function vendor(web, target) {
  const files = trackedContracts(web);
  const commit = git(web, 'rev-parse', 'HEAD').trim();
  const before = readPins(target);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(target)) {
    if (!OURS.includes(name)) rmSync(join(target, name), { recursive: true, force: true });
  }
  for (const path of files) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(web, SOURCE, path), join(target, path));
  }
  /** @type {Record<string, string>} */
  const after = Object.fromEntries(files.map((path) => [path, sha256(join(target, path))]));
  writeFileSync(
    join(target, 'VENDORED.json'),
    `${JSON.stringify({ web: commit, files: after }, null, 2)}\n`,
  );
  return {
    commit,
    added: files.filter((path) => !(path in before)),
    changed: files.filter((path) => path in before && before[path] !== after[path]),
    removed: Object.keys(before)
      .filter((path) => !(path in after))
      .sort(),
  };
}

function main() {
  const web = process.argv[2];
  if (web === undefined) {
    console.error('usage: pnpm contracts:vendor <path-to-web-checkout>');
    process.exit(2);
  }
  const target = fileURLToPath(new URL('../contracts/', import.meta.url));
  try {
    const { commit, added, changed, removed } = vendor(resolve(web), target);
    console.log(`vendored web ${commit}`);
    for (const path of added) console.log(`added    ${path}`);
    for (const path of changed) console.log(`changed  ${path}`);
    for (const path of removed) console.log(`removed  ${path}`);
    if (added.length + changed.length + removed.length === 0) console.log('no file changed');
    console.log(
      'Next, by hand: the web commit and its schema pins into test/contractPins.test.ts (WEB_COMMIT, WEB_PINS).',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
