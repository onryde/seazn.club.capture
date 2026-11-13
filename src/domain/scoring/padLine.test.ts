import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import {
  REFUSAL_WORDS,
  TAKEN,
  noteLine,
  refusalLine,
  refusing,
  type PadLineKey,
} from '@/domain/scoring/padLine';

// The words the last-tap line can say. The domain never imports a dictionary, so this reads the keys back: every one
// is spelled in all four (a key the hook says and no dictionary holds would print its own name on the pad).
const KEYS: readonly PadLineKey[] = [
  'scoring.refusal.notNow',
  'scoring.refusal.invalidScore',
  'scoring.tennis.refusal.invalidScore',
  'scoring.refusal.nothingToUndo',
  'scoring.refusal.notCounted',
  'scoring.refusal.notSaved',
  'scoring.refusal.savePending',
  'scoring.pad.countedOnce',
  'scoring.pad.otherScorerSince',
];

describe('the last-tap line’s words', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s spells every key the line can say', (_lang, dictionary) => {
    const missing = KEYS.filter((key) => (dictionary as Record<string, string>)[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('a refusal says its own words, as each a distinct key', () => {
    expect(REFUSAL_WORDS).toEqual({
      notNow: 'scoring.refusal.notNow',
      invalidScore: 'scoring.refusal.invalidScore',
      invalidSetScore: 'scoring.tennis.refusal.invalidScore',
      nothingToUndo: 'scoring.refusal.nothingToUndo',
    });
  });

  it('builds a refusal and a note, and a tap’s outcome', () => {
    expect(refusalLine('scoring.refusal.notSaved')).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.notSaved',
    });
    expect(noteLine('scoring.pad.countedOnce')).toEqual({
      kind: 'note',
      key: 'scoring.pad.countedOnce',
    });
    expect(TAKEN).toEqual({ ok: true });
    expect(refusing('invalidScore')).toEqual({ ok: false, refusal: 'invalidScore' });
  });
});
