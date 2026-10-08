import { describe, expect, it } from 'vitest';
import { columnLineKey, LINE_TIER, type LineKey, type StatusKey } from '@/hooks/statusKey';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

// Owner ruling, 2026-10-08 (coordinator): the strip's one message line has TWO tiers. Tier 1, URGENT, always wins the
// line: any status that needs action or reports a failure, that is refusals, a stopped or ended stream, a silent
// engine, trouble and degraded reasons, a blocked start, and Back's "hold Stop" line. Tier 2, ROUTINE: plain progress
// ("Live. Sound and picture going out."). An advisory caption beats only a ROUTINE line. One placement is the
// controller's, not the owner's (ruling R2, 2026-10-08): "Waiting for Go live" is URGENT, because it is the one line that
// names where Go live will stream (the destination), and a caption must never hide that.
//
// The expected tiers are written out here from that rule, key by key, and NOT read from the table under test.
// Every status key is in exactly one list, so a new key in the dictionary reds this file until somebody chooses.
const ROUTINE: readonly LineKey[] = [
  'stream.status.starting', // the camera is opening
  'stream.status.pairing', // pairing is under way
  'stream.status.goingLiveOrganiser', // going live, started by the organiser
  'stream.status.goingLiveMatch', // going live, the match has started
  'stream.status.rejoining', // rejoining the live stream
  'stream.status.connecting', // opening the link
  'stream.status.live', // live, sound and picture going out
];

const URGENT: readonly LineKey[] = [
  // Needs somebody to act: the organiser must pick a destination.
  'stream.status.waitingDestination',
  // Ready and waiting for Go live: the only line that names where the stream will go (the destination), so a caption
  // never hides it (controller ruling R2, 2026-10-08).
  'stream.status.waitingGoLive',
  // Refusals and a start that failed or cannot reach Seazn.
  'stream.status.refusedDestination',
  'stream.status.refusedCredit',
  'stream.status.refusedEntitlement',
  'stream.status.refusedUnknown',
  'stream.status.startFailed',
  'stream.status.startRetrying',
  // The phone is not ready: the operator has to do something.
  'stream.status.notReadyCamera',
  'stream.status.notReadySound',
  'stream.status.notReadyNetwork',
  'stream.status.notReadyHeld',
  // Trouble and degraded reasons, on air.
  'stream.status.fellBack',
  'stream.status.weakSignal',
  'stream.status.notDelivered',
  'stream.status.cameraTaken',
  'stream.status.cameraInUse',
  'stream.status.cameraReopening',
  'stream.status.micSilenced',
  'stream.status.holding',
  'stream.status.holdingStalled',
  'stream.status.holdingNotDelivered',
  'stream.status.engineSilent',
  // A stopped or ended stream: stopped, and how it ended.
  'stream.status.stoppedOrganiser',
  'stream.status.stoppedMatch',
  'stream.status.stoppedHoldWindow',
  'stream.status.stoppedNoSignal',
  'stream.status.stoppedMaxDuration',
  'stream.status.stoppedRefused',
  'stream.status.stoppedPhoneLost',
  'stream.status.stoppedBySeazn',
  'stream.status.stopped',
  'stream.status.endedOperator',
  'stream.status.endedFatal',
  // Back's refusal over a calm line.
  'stream.leaveOnAir',
];

const isLineKey = (key: string) => key.startsWith('stream.status.') || key === 'stream.leaveOnAir';
const dictionaryKeys = (dictionary: Record<string, string>) =>
  Object.keys(dictionary).filter(isLineKey).sort();

describe('the strip’s two tiers of line (owner ruling, 2026-10-08)', () => {
  it('chooses a tier for every status key in every language, and for nothing else (exhaustive over the keys)', () => {
    const chosen = [...ROUTINE, ...URGENT].sort();
    // No key is on both lists, and none twice.
    expect(new Set(chosen).size).toBe(chosen.length);
    for (const [lang, dictionary] of [
      ['en', en],
      ['es', es],
      ['fr', fr],
      ['nl', nl],
    ] as const) {
      expect(dictionaryKeys(dictionary), lang).toEqual(chosen);
    }
    // Anti-vacuity: the lists are the whole copy, 41 status keys and Back's line.
    expect(chosen).toHaveLength(42);
    expect(ROUTINE).toHaveLength(7);
    expect(URGENT).toHaveLength(35);
    // And the table has an entry for exactly those keys.
    expect(Object.keys(LINE_TIER).sort()).toEqual(chosen);
  });

  it.each([
    ['routine', ROUTINE],
    ['urgent', URGENT],
  ] as const)('puts every key of the %s list in that tier', (tier, keys) => {
    let checked = 0;
    for (const key of keys) {
      expect({ key, tier: LINE_TIER[key] }).toEqual({ key, tier });
      checked += 1;
    }
    expect(checked).toBe(keys.length);
    expect(checked).toBeGreaterThan(0);
  });

  it('makes Back’s line urgent: it replaces a calm line, and then beats every caption', () => {
    const calm: StatusKey = 'stream.status.live';
    expect(LINE_TIER[calm]).toBe('routine');
    const refused = columnLineKey(calm, true);
    expect(refused).toBe('stream.leaveOnAir');
    expect(LINE_TIER[refused]).toBe('urgent');
    // Not refused: the status line itself, and its own tier.
    expect(LINE_TIER[columnLineKey(calm, false)]).toBe('routine');
  });
});
