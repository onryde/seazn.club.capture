import { describe, expect, it } from 'vitest';
import type { AutoRefusal, LastEnd, PairingInfo, Refusal } from '@/domain/session/Pairing';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { columnLineKey, LINE_TIER, selectStatusKey } from '@/hooks/statusKey';

// Court stream (spec 2026-11-14 §6.2). The expectations are written from the plan's order (refusal, a failure end,
// no destination, automatic off, next with a start, next without, no next), never read back from the function.
const PAIRED_READY: EngineSnapshot = (() => {
  const engine = createFakeCaptureEngine(() => 1_790_000_000_000);
  engine.scene('paired-ready');
  const reported = engine.getSnapshot();
  engine.dispose();
  return reported;
})();

const NEXT_AT = {
  label: 'Example Town v Sample CC',
  scheduledStart: new Date('2026-11-14T14:00:00Z'),
};
const NEXT_NO_START = { label: 'Example Town v Sample CC', scheduledStart: null };

function pairedWith(
  pairing: Partial<PairingInfo>,
  change: Partial<EngineSnapshot> = {},
): EngineSnapshot {
  if (PAIRED_READY.pairing === null) throw new Error('the paired scene holds a pairing');
  return { ...PAIRED_READY, ...change, pairing: { ...PAIRED_READY.pairing, ...pairing } };
}
const court = (pairing: Partial<PairingInfo> = {}, change: Partial<EngineSnapshot> = {}) =>
  pairedWith({ court: 'Court 2', ...pairing }, change);
const key = (snapshot: EngineSnapshot) => selectStatusKey(snapshot);

describe('a court phone waiting between matches (pairedKey on a court code)', () => {
  it('says a refusal first, over everything else on the list', () => {
    const snapshot = court(
      { next: NEXT_AT, destinationName: null },
      { refusal: 'no_credit', lastEnd: 'no-signal' },
    );
    expect(key(snapshot)).toBe('stream.status.refusedCredit');
  });

  // Court stream (capture-start.v1's 409 no_match): a start refused because the court has no streamed match in play, until the next start.
  it('says a start refused no_match over the Next line, and the Next line once it clears', () => {
    const refused = court({ next: NEXT_AT }, { refusal: 'no_match' satisfies Refusal });
    expect(key(refused)).toBe('stream.status.refusedNoMatch');
    expect(LINE_TIER[key(refused)]).toBe('urgent');
    expect(key({ ...refused, refusal: null })).toBe('stream.status.courtNextAt');
  });

  it('says a failure end next, over the Next line', () => {
    expect(key(court({ next: NEXT_AT }, { lastEnd: 'no-signal' }))).toBe(
      'stream.status.stoppedNoSignal',
    );
  });

  it('says there is no destination, before automatic and before the Next line', () => {
    const snapshot = court({ destinationName: null, automatic: false, next: NEXT_AT });
    expect(key(snapshot)).toBe('stream.status.waitingDestination');
  });

  it('says Automatic off when the phone’s automatic mode is off, before the Next line', () => {
    expect(key(court({ automatic: false, next: NEXT_AT }))).toBe('stream.status.courtAutomaticOff');
  });

  it('says the next match and its start when it has one', () => {
    expect(key(court({ next: NEXT_AT }))).toBe('stream.status.courtNextAt');
  });

  it('says the next match alone when it has no start yet', () => {
    expect(key(court({ next: NEXT_NO_START }))).toBe('stream.status.courtNext');
  });

  // An empty input: nothing is queued on the court.
  it('says no streamed match yet with no next', () => {
    expect(key(court({ next: null }))).toBe('stream.status.courtNone');
  });

  it('says the same key twice for the same snapshot (a second call)', () => {
    const snapshot = court({ next: NEXT_AT });
    expect([key(snapshot), key(snapshot)]).toEqual([
      'stream.status.courtNextAt',
      'stream.status.courtNextAt',
    ]);
  });
});

// Review Focus 5: after a match ended normally, the phone shows the Next line, not "Match finished" all afternoon.
describe('a calm last end gives way to the Next line on a court code; a failure end does not', () => {
  it.each<[LastEnd, 'calm' | 'failure', string]>([
    ['stopped-automatically', 'calm', 'stream.status.courtNextAt'],
    ['stopped-by-organiser', 'calm', 'stream.status.courtNextAt'],
    ['stopped', 'calm', 'stream.status.courtNextAt'],
    ['no-signal', 'failure', 'stream.status.stoppedNoSignal'],
    ['destination-refused', 'failure', 'stream.status.stoppedRefused'],
    ['max-duration', 'failure', 'stream.status.stoppedMaxDuration'],
    ['phone-lost', 'failure', 'stream.status.stoppedPhoneLost'],
    ['ended-by-seazn', 'failure', 'stream.status.stoppedBySeazn'],
    ['hold-window-expired', 'failure', 'stream.status.stoppedHoldWindow'],
  ])('%s (%s) says %s', (lastEnd, _kind, expected) => {
    expect(key(court({ next: NEXT_AT }, { lastEnd }))).toBe(expected);
  });

  it('keeps a calm end on a fixture code: the stopped line, as today', () => {
    const fixture = pairedWith({ court: null }, { lastEnd: 'stopped-automatically' });
    expect(key(fixture)).toBe('stream.status.stoppedMatch');
    expect(key(pairedWith({ court: null }, { lastEnd: 'stopped-by-organiser' }))).toBe(
      'stream.status.stoppedOrganiser',
    );
    expect(key(pairedWith({ court: null }, { lastEnd: 'stopped' }))).toBe('stream.status.stopped');
  });

  it('is the Next line again after a calm end and a refusal that has cleared (after an interruption)', () => {
    const refused = court(
      { next: NEXT_AT },
      { lastEnd: 'stopped', refusal: 'unknown' satisfies Refusal },
    );
    expect(key(refused)).toBe('stream.status.refusedUnknown');
    expect(key({ ...refused, refusal: null })).toBe('stream.status.courtNextAt');
  });
});

describe('a fixture code is unchanged', () => {
  it.each<[Partial<PairingInfo>, string]>([
    [{ court: null, next: NEXT_AT }, 'stream.status.waitingGoLive'],
    [{ court: null, automatic: false }, 'stream.status.waitingGoLive'],
    [{ court: null, destinationName: null }, 'stream.status.waitingDestination'],
  ])('%j', (pairing, expected) => {
    expect(key(pairedWith(pairing))).toBe(expected);
  });
});

describe('on air on a court code', () => {
  const publishing: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 };
  const live = (pairing: Partial<PairingInfo>, state: SessionState = publishing) =>
    court(pairing, { state });

  it('the live court line names the next match, with its start when it has one', () => {
    expect(key(live({ next: NEXT_AT }))).toBe('stream.status.courtNextAt');
    expect(key(live({ next: NEXT_NO_START }))).toBe('stream.status.courtNext');
  });

  it('says Live with no next match', () => {
    expect(key(live({ next: null }))).toBe('stream.status.live');
  });

  it('keeps an urgent line over the Next line: degraded and reconnecting say their own', () => {
    const degraded: SessionState = {
      kind: 'degraded',
      transport: 'srt',
      reason: 'poor-uplink',
      sinceEpochMs: 1,
    };
    const holding: SessionState = {
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 38,
      holdWindowSeconds: 183,
      sinceEpochMs: 1,
    };
    expect(key(live({ next: NEXT_AT }, degraded))).toBe('stream.status.weakSignal');
    expect(key(live({ next: NEXT_AT }, holding))).toBe('stream.status.holding');
  });

  it('is unchanged on a fixture code, which never sends next', () => {
    expect(key(live({ court: null, next: NEXT_AT }))).toBe('stream.status.live');
  });

  // The caption beating it is the strip's rule, tested on screen (StreamScreen.paired.test.tsx); here, the tier it rests on.
  it('is a routine line, so an advisory caption beats it', () => {
    expect(LINE_TIER[key(live({ next: NEXT_AT }))]).toBe('routine');
    expect(LINE_TIER[key(live({ next: null }))]).toBe('routine');
  });

  it('lets Back’s "hold Stop" stand in for the Next line, as for Live (ruling I2)', () => {
    expect(columnLineKey('stream.status.courtNextAt', true)).toBe('stream.leaveOnAir');
    expect(columnLineKey('stream.status.courtNext', true)).toBe('stream.leaveOnAir');
    // Waiting between matches is not on air: it is not a calm on-air line, so Back says nothing over it.
    expect(columnLineKey('stream.status.courtNone', true)).toBe('stream.status.courtNone');
    expect(columnLineKey('stream.status.courtNextAt', false)).toBe('stream.status.courtNextAt');
  });
});

// E2 (2026-11-17): the server refused the court's automatic start, so the court's line says why instead of "No streamed
// match yet". The keys and tiers are the brief's table, written out here, never read from the function under test.
describe('a court whose automatic start the server refused', () => {
  const REFUSED_LINES: readonly (readonly [AutoRefusal, string, 'urgent' | 'routine'])[] = [
    ['no_destination', 'stream.status.courtRefusedDestination', 'urgent'],
    ['destination_in_use', 'stream.status.courtDestinationBusy', 'urgent'],
    ['competition_frozen', 'stream.status.courtFrozen', 'urgent'],
    ['no_credit', 'stream.status.refusedCredit', 'urgent'],
    ['not_entitled', 'stream.status.refusedEntitlement', 'urgent'],
    // The server retries every 60 s: plain progress, so an advisory caption may beat it.
    ['unavailable', 'stream.status.courtStartRetrying', 'routine'],
    // Court device check (2026-11-19, web #1265): the match was stopped by hand, and nothing starts it by itself until
    // a person does: the desk's Go live or this phone's hold.
    ['match_stopped', 'stream.status.courtMatchStopped', 'urgent'],
  ];

  it('names all seven words the contract lists, once each', () => {
    expect(REFUSED_LINES.map(([word]) => word).sort()).toEqual([
      'competition_frozen',
      'destination_in_use',
      'match_stopped',
      'no_credit',
      'no_destination',
      'not_entitled',
      'unavailable',
    ]);
  });

  it.each(REFUSED_LINES)('%s says %s, in the %s tier', (autoRefusal, expected, tier) => {
    const line = key(court({ autoRefusal, next: null }));
    expect(line).toBe(expected);
    expect(LINE_TIER[line]).toBe(tier);
  });

  it('says it over the Next line', () => {
    const autoRefusal: AutoRefusal = 'destination_in_use';
    expect(key(court({ autoRefusal, next: NEXT_AT }))).toBe('stream.status.courtDestinationBusy');
  });

  // Fix round 1, I1 (controller's ruling, 2026-11-17): the web retries a court's automatic start only while the phone is
  // automatic, and a missing destination is the organiser's to fix first, so both say their own line over every word:
  // "retrying" never promises a retry that cannot happen, nor hides the cue to start by hand.
  it.each(REFUSED_LINES.map(([word]) => word))(
    'says Automatic off over %s when the phone is manual',
    (autoRefusal) => {
      expect(key(court({ autoRefusal, automatic: false, next: NEXT_AT }))).toBe(
        'stream.status.courtAutomaticOff',
      );
    },
  );

  it.each(REFUSED_LINES.map(([word]) => word))(
    'says the missing destination over %s when the phone is automatic',
    (autoRefusal) => {
      expect(key(court({ autoRefusal, automatic: true, destinationName: null }))).toBe(
        'stream.status.waitingDestination',
      );
    },
  );

  it('says the refusal again once the phone is automatic and the destination is back', () => {
    const manual = court({ autoRefusal: 'unavailable', automatic: false, destinationName: null });
    expect(key(manual)).toBe('stream.status.waitingDestination');
    const noDestination = court({ autoRefusal: 'unavailable', destinationName: null });
    expect(key(noDestination)).toBe('stream.status.waitingDestination');
    expect(key(court({ autoRefusal: 'unavailable', automatic: false }))).toBe(
      'stream.status.courtAutomaticOff',
    );
    expect(key(court({ autoRefusal: 'unavailable' }))).toBe('stream.status.courtStartRetrying');
  });

  it('gives way to the operator’s start in flight, the phone’s own refusal and a failure end', () => {
    const autoRefusal: AutoRefusal = 'no_destination';
    expect(key(court({ autoRefusal, starting: true }))).toBe('stream.status.connecting');
    expect(key(court({ autoRefusal }, { refusal: 'start-failed' satisfies Refusal }))).toBe(
      'stream.status.startFailed',
    );
    expect(key(court({ autoRefusal }, { lastEnd: 'no-signal' }))).toBe(
      'stream.status.stoppedNoSignal',
    );
  });

  // After an interruption: the match ended calmly and the server's next automatic start was refused.
  it('says it after a calm end, where the Next line would be', () => {
    const snapshot = court({ autoRefusal: 'unavailable', next: NEXT_AT }, { lastEnd: 'stopped' });
    expect(key(snapshot)).toBe('stream.status.courtStartRetrying');
  });

  // N46 (court device check, 2026-11-19): the phone's own court Stop is a calm end, and the server's next waiting answer
  // says the match was stopped by hand; the hold restarts it, and once a start is in flight the server omits the word.
  it('says the stopped match after this phone’s own court Stop, then the hold’s start, then the Next line', () => {
    const stopped = court({ autoRefusal: 'match_stopped', next: NEXT_AT }, { lastEnd: 'stopped' });
    expect(key(stopped)).toBe('stream.status.courtMatchStopped');
    const organiser = court(
      { autoRefusal: 'match_stopped', next: NEXT_AT },
      { lastEnd: 'stopped-by-organiser' },
    );
    expect(key(organiser)).toBe('stream.status.courtMatchStopped');
    expect(key(court({ autoRefusal: 'match_stopped', starting: true }))).toBe(
      'stream.status.connecting',
    );
    expect(key(court({ autoRefusal: null, next: NEXT_AT }, { lastEnd: 'stopped' }))).toBe(
      'stream.status.courtNextAt',
    );
  });

  it('is the Next line again once the server stops sending it', () => {
    const refused = court({ autoRefusal: 'competition_frozen', next: NEXT_AT });
    expect(key(refused)).toBe('stream.status.courtFrozen');
    expect(key(court({ autoRefusal: null, next: NEXT_AT }))).toBe('stream.status.courtNextAt');
    expect(key(court({ autoRefusal: null, next: null }))).toBe('stream.status.courtNone');
  });

  it('says the same key twice for the same snapshot (a second call)', () => {
    const snapshot = court({ autoRefusal: 'no_credit' });
    expect([key(snapshot), key(snapshot)]).toEqual([
      'stream.status.refusedCredit',
      'stream.status.refusedCredit',
    ]);
  });

  // Another mode: the contract sends it on court codes only; a fixture code's line never reads it.
  it('is never said on a fixture code', () => {
    expect(key(pairedWith({ court: null, autoRefusal: 'no_destination' }))).toBe(
      'stream.status.waitingGoLive',
    );
  });

  // Paired only: the live beats omit it, and native clears it at Arming, but the line never reads it on air either.
  it('is never said on air', () => {
    const publishing: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 };
    expect(key(court({ autoRefusal: 'no_destination', next: null }, { state: publishing }))).toBe(
      'stream.status.live',
    );
  });
});

// N46 (court device check, 2026-11-19): a build the server refused had every beat answered 404, so nothing was ever heard,
// and the line said "Waiting for the organiser to pick a destination": a fact about a destination nobody had read. Native
// holds the waiting fields' defaults (label "", no destination) until the first 2xx; the contract's label is 1 to 200
// characters, so an empty label is a pairing the server has not answered. Until it does, the line is the pairing's.
describe('a pairing the server has not answered yet', () => {
  const failing = {
    ...PAIRED_READY.telemetry,
    heartbeat: { lastSentAtEpochMs: 1, lastResult: 'failed', consecutiveFailures: 6, failures: 6 },
  } as const;
  const unheard: Partial<PairingInfo> = { label: '', destinationName: null, autoAllowed: false };

  it.each<[string, Partial<PairingInfo>]>([
    ['a fixture code', { court: null }],
    ['a court code', { court: 'Court 2' }],
  ])('says Pairing this phone… on %s, never the destination line', (_name, code) => {
    const snapshot = pairedWith({ ...unheard, ...code }, { telemetry: failing });
    expect(key(snapshot)).toBe('stream.status.pairing');
    expect(key(snapshot)).toBe('stream.status.pairing');
  });

  it('says it with no beat answered yet, as with every beat failing', () => {
    expect(key(court(unheard))).toBe('stream.status.pairing');
    expect(key(pairedWith({ ...unheard, court: null }))).toBe('stream.status.pairing');
  });

  it('gives way to the hold’s start in flight and to a refusal, as every paired line does', () => {
    expect(key(court({ ...unheard, starting: true }))).toBe('stream.status.connecting');
    expect(key(court(unheard, { refusal: 'start-failed' satisfies Refusal }))).toBe(
      'stream.status.startFailed',
    );
  });

  // After an interruption: the first answer lands, and the destination it names (or its absence) is now a fact.
  it('says what the first answer says once it lands', () => {
    expect(key(pairedWith({ court: null, destinationName: null }))).toBe(
      'stream.status.waitingDestination',
    );
    expect(key(court({ next: null }))).toBe('stream.status.courtNone');
    expect(key(pairedWith({ court: null }))).toBe('stream.status.waitingGoLive');
  });

  it('is a routine line, as it is while native asks for permissions', () => {
    expect(LINE_TIER[key(court(unheard))]).toBe('routine');
  });
});
