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
  [/^stream\.peek\.label$/, 28],
  [/^stream\.peek\.unavailable$/, 24],
  [/^stream\.ended\.scanAnother$/, 16],
  [/^stream\.ended\.(duration|neverLive)$/, 24],
  // The links share the bottom strip with the match label and Home.
  [/^stream\.link\./, 14],
  [/^stream\.back$/, 20],
];

const WIDEST: Readonly<Record<string, string>> = {
  remaining: '183',
  window: '183',
  time: '14:32 CEST',
  duration: '10:00:00',
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
