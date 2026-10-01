// Refuses a release while any dictionary carries a `_review` marker, which
// means "awaiting translation review" (spec §6). Since the owner's ruling of
// 2026-10-01 that review is an AI pass against docs/i18n-glossary.md, not a
// native speaker. Development builds and CI ignore the marker; releases must not.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../src/i18n/', import.meta.url);
const pending = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .filter((name) => '_review' in JSON.parse(readFileSync(new URL(name, dir), 'utf8')));

if (pending.length > 0) {
  console.error(`Translations not yet reviewed: ${pending.join(', ')}`);
  process.exit(1);
}
