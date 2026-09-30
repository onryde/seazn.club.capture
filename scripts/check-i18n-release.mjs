// Refuses a release while any translation still waits for a native speaker
// (spec §6). Development builds and CI ignore the marker; releases must not.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../src/i18n/', import.meta.url);
const pending = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .filter((name) => '_review' in JSON.parse(readFileSync(new URL(name, dir), 'utf8')));

if (pending.length > 0) {
  console.error(`Translations not yet reviewed: ${pending.join(', ')}`);
  process.exit(1);
}
