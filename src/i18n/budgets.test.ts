import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { DESTINATION_CAP } from '@/domain/session/destination';

/**
 * Copy budgets for the HUD column (S0 R-budget; spec §6 "the longest one on
 * the HUD column"). A `numberOfLines` truncation throws no error, so the
 * budget is enforced here, in every language, with the widest values filled in.
 * Later tasks add rows.
 */
const BUDGETS: readonly (readonly [keys: RegExp, max: number])[] = [
  [/^stream\.status\./, 48],
  // M4: it stands in the status line, so it shares its budget.
  [/^stream\.leaveOnAir$/, 48],
  [/^stream\.tally\./, 12],
  [/^stream\.action\.(goLive|stop)$/, 16],
  [/^stream\.chip\.(camera|sound|network|auto)$/, 10],
  [/^stream\.blocker\./, 24],
  // Replaces stream.goLiveBy's row: the same line, under the chips.
  [/^stream\.startsAt$/, 32],
  [/^stream\.advisory\./, 56],
  // Task 31's copy for Task 39's preview: its line under the stage, and its button.
  [/^stream\.preview\.stopped$/, 56],
  [/^stream\.preview\.show$/, 16],
  [/^stream\.peek\.label$/, 28],
  [/^stream\.peek\.(unavailable|hot)$/, 24],
  [/^stream\.peek\.loading$/, 44],
  // D2 §4.3: the cover's honest line, its countdown, the not-ready line and its Hide.
  [/^stream\.peek\.honest$/, 44],
  [/^stream\.peek\.closesIn$/, 24],
  [/^stream\.peek\.notReady$/, 56],
  [/^stream\.peek\.hide$/, 14],
  // Take photo (spec §8): the icon's accessible name, and the one line over the icon row.
  [/^stream\.photo\.label$/, 20],
  [/^stream\.photo\.(saved|failed)$/, 36],
  // Remote scoring (spec §10): the icon's accessible name (like Take photo's), the panel's title (B1) and its
  // countdown (B3), the sentences, and Hide.
  [/^stream\.scoring\.open$/, 20],
  [/^stream\.scoring\.(title|hidesIn)$/, 24],
  [/^stream\.scoring\.refused\./, 56],
  // `code` is a screen-reader name, but a row per key keeps a new key from being added unbudgeted.
  [/^stream\.scoring\.(hint|asking|code)$/, 48],
  [/^stream\.scoring\.hide$/, 14],
  [/^stream\.ended\.(duration|neverLive)$/, 24],
  // The link is the Settings icon's accessible name, in the icon row (spec §3).
  [/^stream\.link\./, 14],
  [/^stream\.back$/, 20],
];

const WIDEST: Readonly<Record<string, string>> = {
  remaining: '183',
  window: '183',
  time: '14:32 CEST',
  duration: '10:00:00',
  // Remote scoring: a Retry-After the hook clamps at 300 (useScoringLink), and the countdown's 10 at most.
  seconds: '300',
  // Amendment §2, footnote 1: `cutDestination` never lets the name past 24.
  destination: 'X'.repeat(DESTINATION_CAP),
};

const fill = (text: string) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => WIDEST[name] ?? whole);

describe.each([
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const)('%s copy budgets', (_lang, dictionary: Readonly<Record<string, string>>) => {
  it.each(BUDGETS)('every %s key fits in %i characters', (pattern, max) => {
    const keys = Object.keys(dictionary).filter((key) => pattern.test(key));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const text = fill(dictionary[key] ?? '');
      expect({ key, text, fits: text.length <= max }).toEqual({ key, text, fits: true });
    }
  });
});
