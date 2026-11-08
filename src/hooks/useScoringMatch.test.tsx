import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsProvider } from '@/hooks/usePorts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { useBadmintonMatch } from '@/hooks/useBadmintonMatch';
import { SINGLES_SEED, createFakeScoringPort } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { SINGLES } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// The match hook (plan S2-1 Task 9): what the pad screen is drawn from, over the real runner, hub, queue store and
// reducer, and the fake server. Copy is keys here (Task 11 draws the words); every expectation is a literal.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

function mount(fakes: FakePorts, options: { strict?: boolean; id?: string } = {}) {
  const id = options.id ?? FIXTURE;
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <PortsProvider ports={fakes.ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    );
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  }
  return renderHook(() => useBadmintonMatch(id), { wrapper: Wrapper });
}

async function rig(over: Parameters<typeof createFakePorts>[0] = {}): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, ...over });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  return fakes;
}

type Pad = Extract<ReturnType<typeof useBadmintonMatch>, { kind: 'pad' }>;
function pad(match: ReturnType<typeof useBadmintonMatch>): Pad {
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

/** The pad with the match started, first side serving, and the bounce window of Start match (250 ms) over. */
async function started(fakes: FakePorts) {
  const view = mount(fakes);
  await flush();
  act(() => pad(view.result.current).actions.pickServer('first'));
  act(() => pad(view.result.current).actions.start());
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('before the pad', () => {
  it('is loading until the first read lands, then the pad', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    expect(view.result.current).toEqual({ kind: 'loading', offline: false });
    await flush();
    expect(view.result.current.kind).toBe('pad');
  });

  it('with no link saved is a link that is gone', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'linkGone' });
  });

  it('with a link the server has revoked, and nothing of the match kept, is a link that is gone', async () => {
    const fakes = await rig();
    fakes.scoring.revoke();
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'linkGone' });
  });

  it('with a queue file that cannot be read is unreadable, never an empty pad', async () => {
    const fakes = await rig();
    fakes.queueFiles.files.set(`${FIXTURE}.json`, '{ not json');
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unreadable', what: 'queue' });
  });

  it('with no network and nothing cached is loading, and says it is offline', async () => {
    const fakes = await rig();
    fakes.scoring.goOffline(true);
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'loading', offline: true });
  });

  it('of a sport this build does not score says which', async () => {
    const seed = createFakeScoringPort(SINGLES_SEED);
    const scoring = {
      ...seed,
      bootstrap: async () => ({
        kind: 'ok' as const,
        bootstrap: { ...SINGLES, sportKey: 'tennis' },
      }),
    };
    const fakes = await rig({ scoring });
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unsupportedSport', sportKey: 'tennis' });
  });

  it('kept as a sport this build does not score says which at once, offline too, and reads nothing', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'tennis');
    fakes.scoring.goOffline(true);
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unsupportedSport', sportKey: 'tennis' });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('whose ledger is over the size the phone reads is too large to score here', async () => {
    const seed = createFakeScoringPort(SINGLES_SEED);
    const scoring = { ...seed, events: async () => ({ kind: 'tooLarge' as const }) };
    const fakes = await rig({ scoring });
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'tooLarge' });
  });
});

describe('the pad', () => {
  it('shows the Start screen of a match not yet started, with no pick', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    const model = pad(view.result.current);
    expect(model.toss).toBeNull();
    expect(model.view.start).not.toBeNull();
    expect(model.sheet).toBeNull();
    expect(model.line).toBeNull();
  });

  // S2-4 Batch 2 re-review N1: the serve pick is kept in the boot cache; a disk that refuses it twice is said on the
  // line, which the Start screen draws (PadContent.test.tsx), and a later save the disk takes clears it (N2).
  it('a serve pick the disk refuses twice is said on the line before Start; a later pick it takes clears it', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    // The disk refuses from here on: the match opened (and cached its bootstrap) before.
    const saveBoot = vi
      .spyOn(fakes.tapQueue, 'saveBoot')
      .mockRejectedValueOnce(new Error('the disk refused'))
      .mockRejectedValueOnce(new Error('the disk refused'));
    act(() => pad(view.result.current).actions.pickServer('second'));
    await flush();
    expect(pad(view.result.current).view.start).not.toBeNull();
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.choiceNotSaved',
    });
    act(() => pad(view.result.current).actions.pickServer('first'));
    await flush();
    expect(saveBoot).toHaveBeenCalledTimes(3);
    expect((await fakes.tapQueue.loadBoot(FIXTURE))?.toss).toBe('first');
    expect(pad(view.result.current).line).toBeNull();
  });

  it('a rally before the match has started is refused on the line, and nothing is sent', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = mount(fakes);
    await flush();
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.notNow',
    });
    expect(append).not.toHaveBeenCalled();
  });

  it('Start with no pick does nothing; with a pick it starts the match under a v4 key and drops the pick', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = mount(fakes);
    await flush();
    act(() => pad(view.result.current).actions.start());
    await flush();
    expect(append).not.toHaveBeenCalled();
    act(() => pad(view.result.current).actions.pickServer('second'));
    expect(pad(view.result.current).toss).toBe('second');
    act(() => pad(view.result.current).actions.start());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(append.mock.calls[0][2].idempotency_key).toMatch(UUID_V4);
    expect(pad(view.result.current).toss).toBeNull();
    expect(pad(view.result.current).view.start).toBeNull();
  });

  it('a rally counts on the half once and is sent; the score is the engine’s', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pad(view.result.current).view.halves[0].value).toBe('1');
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'synced' });
  });

  it('a tap’s key is a v4 UUID also where the runtime has no crypto', async () => {
    vi.stubGlobal('crypto', undefined);
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const keys = append.mock.calls.map((call) => call[2].idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    keys.forEach((key) => expect(key).toMatch(UUID_V4));
  });

  it('a second tap on the same half inside the bounce window counts once, and the line says so', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => {
      pad(view.result.current).actions.tapHalf('first');
      pad(view.result.current).actions.tapHalf('first');
    });
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pad(view.result.current).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('every tap has its own key, a v4 UUID', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const random = vi.spyOn(globalThis.crypto, 'randomUUID');
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      pad(view.result.current).actions.tapHalf('second');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(random).toHaveBeenCalledTimes(3);
    const keys = append.mock.calls.map((call) => call[2].idempotency_key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    keys.forEach((key) => expect(key).toMatch(UUID_V4));
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain('scoring.keyFallback');
  });

  // The phone's Hermes has no `crypto` (device, 2026-11-02: the record said `scoring.keyFallback`, so every key was
  // Math.random's). expo-modules-core installs a native v4 UUID generator on `globalThis.expo` (Android's
  // `UUID.randomUUID`, a SecureRandom; iOS's `UUID()`): it is the first choice, with no new dependency.
  describe('a tap’s key from the native generator', () => {
    const NATIVE = [
      '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10',
      '0b3c2f51-9a77-4c1e-8d24-7a5e1f6c3b88',
      '9d1e7c44-2b60-4f93-a0c5-5e8b2d7a1c19',
    ];
    const taps = async (fakes: Awaited<ReturnType<typeof rig>>) => {
      const append = vi.spyOn(fakes.scoring, 'append');
      const view = await started(fakes);
      await act(async () => {
        pad(view.result.current).actions.tapHalf('first');
        await vi.advanceTimersByTimeAsync(1_000);
      });
      return append.mock.calls.map((call) => call[2].idempotency_key);
    };

    it('is the key, where the runtime has no crypto at all, and the record says nothing of a fallback', async () => {
      const made = [...NATIVE];
      const uuidv4 = vi.fn(() => made.shift() as string);
      vi.stubGlobal('expo', { uuidv4 });
      vi.stubGlobal('crypto', undefined);
      const random = vi.spyOn(Math, 'random');
      const fakes = await rig();
      expect(await taps(fakes)).toEqual(NATIVE.slice(0, 2));
      expect(uuidv4).toHaveBeenCalledTimes(2);
      expect(random).not.toHaveBeenCalled();
      expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
        'scoring.keyFallback',
      );
    });

    it('wins over the runtime’s own randomUUID: that one is not asked', async () => {
      const made = [...NATIVE];
      vi.stubGlobal('expo', { uuidv4: () => made.shift() as string });
      const fakes = await rig();
      const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID');
      expect(await taps(fakes)).toEqual(NATIVE.slice(0, 2));
      expect(randomUUID).not.toHaveBeenCalled();
    });

    it('is not there (no `expo`, or one without the generator): the runtime’s crypto stands in, and says nothing', async () => {
      for (const expo of [undefined, {}, { uuidv4: 'not a function' }]) {
        vi.stubGlobal('expo', expo);
        const fakes = await rig();
        const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID');
        const keys = await taps(fakes);
        expect(keys, JSON.stringify(expo)).toHaveLength(2);
        keys.forEach((key) => expect(key).toMatch(UUID_V4));
        expect(randomUUID).toHaveBeenCalled();
        expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
          'scoring.keyFallback',
        );
        randomUUID.mockRestore();
      }
    });

    // Review minor 5 (round 2): a key is whatever the generator answers, so what it answers is read. A throw or a
    // non-key falls through to the next generator, so the tap is never lost for it and no key is '' or `undefined`.
    it.each([
      ['an empty string', () => ''],
      ['undefined', () => undefined],
      ['null', () => null],
      ['a number', () => 42],
      ['an object', () => ({})],
      [
        'a throw',
        () => {
          throw new Error('native module not ready');
        },
      ],
    ])(
      'answers %s: the runtime’s crypto stands in, the tap goes under a v4 key, and the record says nothing',
      async (_, answer) => {
        vi.stubGlobal('expo', { uuidv4: vi.fn(answer) });
        const fakes = await rig();
        const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID');
        const keys = await taps(fakes);
        expect(keys).toHaveLength(2);
        keys.forEach((key) => expect(key).toMatch(UUID_V4));
        expect(randomUUID).toHaveBeenCalled();
        expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
          'scoring.keyFallback',
        );
      },
    );

    it('answers a throw with no crypto either: Math.random stands in, and the record says so once', async () => {
      vi.stubGlobal('expo', {
        uuidv4: () => {
          throw new Error('native module not ready');
        },
      });
      vi.stubGlobal('crypto', undefined);
      const fakes = await rig();
      const keys = await taps(fakes);
      keys.forEach((key) => expect(key).toMatch(UUID_V4));
      expect(
        readRecord(fakes.record).filter((line) => line.event === 'scoring.keyFallback'),
      ).toHaveLength(1);
    });

    it('is not there and neither is crypto: Math.random keys, and the record says so once', async () => {
      vi.stubGlobal('expo', {});
      vi.stubGlobal('crypto', undefined);
      const fakes = await rig();
      const keys = await taps(fakes);
      keys.forEach((key) => expect(key).toMatch(UUID_V4));
      const lines = readRecord(fakes.record).filter((line) => line.event === 'scoring.keyFallback');
      expect(lines).toHaveLength(1);
    });
  });

  it('a tap’s key is made of getRandomValues where the runtime has no randomUUID, and says nothing', async () => {
    const real = globalThis.crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>) => real.getRandomValues(bytes));
    vi.stubGlobal('crypto', { getRandomValues });
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    const keys = append.mock.calls.map((call) => call[2].idempotency_key);
    expect(keys).toHaveLength(2);
    keys.forEach((key) => expect(key).toMatch(UUID_V4));
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain('scoring.keyFallback');
  });

  it('a tap’s key is the runtime’s own UUID where it has one, and says nothing', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const made = [
      '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10',
      '0b3c2f51-9a77-4c1e-8d24-7a5e1f6c3b88',
      '9d1e7c44-2b60-4f93-a0c5-5e8b2d7a1c19',
    ];
    const randomUUID = vi.fn(() => made.shift() as string);
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: undefined });
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(append.mock.calls.map((call) => call[2].idempotency_key)).toEqual([
      '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10',
      '0b3c2f51-9a77-4c1e-8d24-7a5e1f6c3b88',
    ]);
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain('scoring.keyFallback');
  });

  it('with no crypto at all the keys still come, and the record says once that they are not strong', async () => {
    vi.stubGlobal('crypto', undefined);
    const fakes = await rig();
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      pad(view.result.current).actions.tapHalf('second');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const lines = readRecord(fakes.record).filter((line) => line.event === 'scoring.keyFallback');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
  });

  it('offline the tap is shown at once as waiting, and drains when the network is back', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    expect(pad(view.result.current).view.halves[0].value).toBe('1');
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'offline', count: 1 });
    fakes.scoring.goOffline(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'synced' });
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
  });

  it('Undo of a tap still only queued takes it out and sends nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.foreground.leave();
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    expect(pad(view.result.current).view.halves[0].value).toBe('1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.undo());
    await flush();
    expect(pad(view.result.current).view.halves[0].value).toBe('0');
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'synced' });
    fakes.foreground.fire();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('Undo of a tap that may have reached the server waits for the answer, then voids it', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.dropNextAnswer();
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.undo());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
    expect(pad(view.result.current).view.halves[0].value).toBe('0');
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'synced' });
  });

  it('Undo waiting for its tap’s answer shows the tap taken back and says the Undo waits; it leaves the line when sent', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.dropNextAnswer();
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    act(() => pad(view.result.current).actions.undo());
    await flush();
    expect(pad(view.result.current).view.halves[0].value).toBe('0');
    expect(pad(view.result.current).line).toEqual({ kind: 'note', key: 'scoring.pad.undoWaiting' });
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'offline', count: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(pad(view.result.current).line).toBeNull();
    expect(pad(view.result.current).view.sync).toEqual({ kind: 'synced' });
  });

  it('Undo of an accepted tap is a void, sent under its own key', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.undo());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
    expect(pad(view.result.current).view.halves[0].value).toBe('0');
  });

  it('Undo with nothing to undo says so', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act(() => pad(view.result.current).actions.undo());
    await flush();
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.nothingToUndo',
    });
  });

  it('another scorer’s tap arrives by the channel, and the pad shows it with Undo off', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view.result.current).view.halves[0].value).toBe('1');
    expect(pad(view.result.current).line).toEqual({
      kind: 'note',
      key: 'scoring.pad.otherScorerSince',
    });
  });
});

describe('a match another scorer finalizes while the pad shows', () => {
  /** The match started by this phone, 41 rallies by the first side from another scorer, then this phone's 42nd. */
  async function decidedByThisPhone(fakes: FakePorts) {
    const view = await started(fakes);
    for (let i = 0; i < 41; i += 1) {
      fakes.scoring.addOtherScorerEvent('badminton.rally', {
        wonBy: SINGLES_SEED.sides.home.entrantId,
      });
    }
    fakes.realtime.ping();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    return view;
  }

  it('turns the pad view-only within the bootstrap’s pace, with Undo off: the result is no longer this phone’s to take back', async () => {
    const fakes = await rig();
    const view = await decidedByThisPhone(fakes);
    expect(pad(view.result.current).view.halves[0].value).toBe('21');
    // The deciding tap has just been shown: the whole Undo window is open (owner, 2026-11-03).
    expect(pad(view.result.current).view.card).toEqual({ kind: 'resultRecorded', undoLeft: 45 });
    expect(pad(view.result.current).view.lastTap?.undo).toBe(true);
    fakes.scoring.finalize();
    fakes.realtime.ping();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(pad(view.result.current).view.card).toEqual({ kind: 'viewOnly' });
    expect(pad(view.result.current).view.lastTap?.undo).toBe(false);
    act(() => pad(view.result.current).actions.undo());
    await flush();
    expect(await ledgerTypes(fakes)).not.toContain('core.void');
  });

  it('is told at once when it is told again later: a second ping after the pace is one more read, not a storm', async () => {
    const fakes = await rig();
    const view = await decidedByThisPhone(fakes);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    fakes.scoring.finalize();
    for (let i = 0; i < 5; i += 1) fakes.realtime.ping();
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(pad(view.result.current).view.card).toEqual({ kind: 'viewOnly' });
  });
});

describe('the sheets', () => {
  it('Match details opens a sheet, and Back closes it', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act(() => pad(view.result.current).actions.details());
    expect(pad(view.result.current).sheet?.kind).toBe('details');
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view.result.current).sheet).toBeNull();
  });

  it('a sheet open when the match turns into a state of its own is closed with the pad', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => pad(view.result.current).actions.details());
    expect(pad(view.result.current).sheet?.kind).toBe('details');
    vi.spyOn(fakes.scoring, 'events').mockResolvedValue({ kind: 'tooLarge' });
    fakes.realtime.ping();
    await flush();
    expect(view.result.current).toEqual({ kind: 'tooLarge' });
    let handled = true;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(false);
  });

  it('a sheet open when the link dies is closed, and the bad-link card shows', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => pad(view.result.current).actions.details());
    expect(pad(view.result.current).sheet?.kind).toBe('details');
    fakes.scoring.revoke();
    await act(async () => {
      pad(view.result.current).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(pad(view.result.current).view.card).toEqual({ kind: 'linkInvalid' });
    expect(pad(view.result.current).sheet).toBeNull();
    let handled = true;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(false);
  });
});

/** A disqualification recorded by this phone: the pad then asks for the ending (the sheet steps wait out their bounce). */
async function disqualified(fakes: FakePorts, options: { waitOutBounce?: boolean } = {}) {
  const view = await started(fakes);
  const step = async (act_: () => void) => {
    act(act_);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  };
  await step(() => pad(view.result.current).actions.tool('sanction.second'));
  await step(() => pad(view.result.current).actions.choose('disqualification'));
  await step(() => pad(view.result.current).actions.choose('0'));
  act(() => pad(view.result.current).actions.choose('confirm'));
  if (options.waitOutBounce !== false) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }
  return view;
}

describe('a disqualification', () => {
  it('asks for the ending once recorded, and Record ending ends the match as the other side’s win', async () => {
    const fakes = await rig();
    const view = await disqualified(fakes);
    expect(pad(view.result.current).sheet?.kind).toBe('ending');
    act(() => pad(view.result.current).actions.recordEnding());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.sanction', 'core.forfeit']);
    expect(pad(view.result.current).sheet).toBeNull();
  });

  it('takes no ending and no void in the bounce window of its prompt appearing', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = await disqualified(fakes, { waitOutBounce: false });
    await flush();
    const sent = append.mock.calls.length;
    act(() => pad(view.result.current).actions.recordEnding());
    act(() => pad(view.result.current).actions.voidSanction());
    await flush();
    expect(append.mock.calls.length).toBe(sent);
    expect(pad(view.result.current).sheet?.kind).toBe('ending');
  });

  it('Void takes the sanction back, and the prompt goes with it', async () => {
    const fakes = await rig();
    const view = await disqualified(fakes);
    act(() => pad(view.result.current).actions.voidSanction());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.sanction', 'core.void']);
    expect(pad(view.result.current).sheet).toBeNull();
  });

  it('a Void kept past its prompt takes the next rally of the match back for no one', async () => {
    const fakes = await rig();
    const view = await disqualified(fakes);
    const { voidSanction } = pad(view.result.current).actions;
    act(() => voidSanction());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => voidSanction());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual([
      'core.start',
      'badminton.sanction',
      'core.void',
      'badminton.rally',
    ]);
    expect(pad(view.result.current).view.halves[0].value).toBe('1');
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.notNow',
    });
  });
});

describe('what the scorer’s touches carry', () => {
  it('a tap is stamped with the phone’s clock when it is made', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.foreground.leave();
    act(() => pad(view.result.current).actions.tapHalf('first'));
    await flush();
    const queue = await fakes.tapQueue.load(FIXTURE);
    expect(queue?.pending.map((one) => one.createdAt)).toEqual(['2026-11-02T09:00:01.000Z']);
  });

  it('a tool tapped inside the bounce window of Start match opens nothing, and one tapped after it opens its sheet', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act(() => pad(view.result.current).actions.pickServer('first'));
    act(() => pad(view.result.current).actions.start());
    await flush();
    act(() => pad(view.result.current).actions.tool('setScore'));
    expect(pad(view.result.current).sheet).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.tool('setScore'));
    expect(pad(view.result.current).sheet?.kind).toBe('setScore');
  });

  it('a score no game in progress has is refused on the line, and nothing is sent', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => pad(view.result.current).actions.tool('setScore'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.saveScore('40', '3'));
    await flush();
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.invalidScore',
    });
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('a field that is not a whole number is refused on the line, and nothing is sent', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => pad(view.result.current).actions.tool('setScore'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.saveScore('4x', '3'));
    await flush();
    expect(pad(view.result.current).line).toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.invalidScore',
    });
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });
});

describe('a disqualification pushed by another scorer', () => {
  const HOME = SINGLES_SEED.sides.home.entrantId;

  async function pushed(fakes: FakePorts) {
    const view = await started(fakes);
    fakes.scoring.addOtherScorerEvent('badminton.sanction', {
      by: HOME,
      level: 'disqualification',
      person: `${HOME}-p1`,
    });
    fakes.realtime.ping();
    await flush();
    return view;
  }

  it('Record ending and Void take no tap in the bounce window of the prompt appearing, and Record ending does after it', async () => {
    const fakes = await rig();
    const view = await pushed(fakes);
    expect(pad(view.result.current).sheet?.kind).toBe('ending');
    act(() => pad(view.result.current).actions.voidSanction());
    act(() => pad(view.result.current).actions.recordEnding());
    await flush();
    expect(pad(view.result.current).line).toEqual({
      kind: 'note',
      key: 'scoring.pad.otherScorerSince',
    });
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.sanction']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => pad(view.result.current).actions.recordEnding());
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.sanction', 'core.forfeit']);
  });

  it('Record ending with no disqualification waiting records nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    act(() => pad(view.result.current).actions.recordEnding());
    await flush();
    expect(append).not.toHaveBeenCalled();
  });
});

describe('the update banner', () => {
  it('opens the store’s listing for the first button and the scoring link for the second', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    await act(async () => {
      pad(view.result.current).actions.update();
      pad(view.result.current).actions.browser();
    });
    expect(fakes.link.opened).toEqual([
      'https://play.google.com/store/apps/details?id=com.seazn.capture',
      `https://stg.seazn.club/score/${FAKE_SCORING_SECRET}`,
    ]);
    expect(pad(view.result.current).cardNote).toBeNull();
  });

  it('a page that will not open says so on the banner, and a later one that opens clears it', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.link.refuse();
    await act(async () => pad(view.result.current).actions.update());
    expect(pad(view.result.current).cardNote).toBe('scoring.card.cantOpen');
    fakes.link.refuse(false);
    await act(async () => pad(view.result.current).actions.update());
    expect(pad(view.result.current).cardNote).toBeNull();
  });
});

describe('the update banner with no link to open', () => {
  it('a link kept for another host is no link: the pad is the link-gone card, and nothing is opened', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await fakes.kv.set(
      `scoring.link.${FIXTURE}`,
      JSON.stringify({
        origin: 'https://evil.example',
        token: FAKE_SCORING_SECRET,
        sportKey: 'badminton',
      }),
    );
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'linkGone' });
    expect(fakes.link.opened).toEqual([]);
  });
});

describe('the update banner with a build that has lost its host', () => {
  it('Score in the browser says it cannot open the page, and opens nothing', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    // The defensive branch: a link was read for the build's host, and the build's hosts are empty by the time of the tap.
    (fakes.ports.hosts as string[]).length = 0;
    await act(async () => pad(view.result.current).actions.browser());
    expect(fakes.link.opened).toEqual([]);
    expect(pad(view.result.current).cardNote).toBe('scoring.card.cantOpen');
  });
});

describe('the screen leaving', () => {
  it('releases the match: nothing keeps running, and the channel is closed', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(2);
    view.unmount();
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(0);
    expect(fakes.realtime.subscriptions.map((one) => one.open)).toEqual([false]);
  });

  it('actions kept past the screen do nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    const { actions } = pad(view.result.current);
    view.unmount();
    await flush();
    const append = vi.spyOn(fakes.scoring, 'append');
    act(() => actions.tapHalf('first'));
    act(() => actions.undo());
    await flush();
    expect(append).not.toHaveBeenCalled();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('under StrictMode’s double mount ends with one running match', async () => {
    const fakes = await rig();
    const view = mount(fakes, { strict: true });
    await flush();
    expect(view.result.current.kind).toBe('pad');
    expect(fakes.foreground.returnListeners()).toBe(2);
    expect(fakes.realtime.subscriptions.filter((one) => one.open)).toHaveLength(1);
  });

  it('another match is another runner: the first is released', async () => {
    const fakes = await rig();
    await saveScoringLink(fakes.kv, 'm-other', LINK, HOST, 'badminton');
    let id = FIXTURE;
    const seen: string[] = [];
    const view = renderHook(
      () => {
        const match = useBadmintonMatch(id);
        seen.push(match.kind);
        return match;
      },
      {
        wrapper: ({ children }) => (
          <PortsProvider ports={fakes.ports}>
            <LanguageProvider>{children}</LanguageProvider>
          </PortsProvider>
        ),
      },
    );
    await flush();
    expect(fakes.realtime.subscriptions.map((one) => one.open)).toEqual([true]);
    id = 'm-other';
    seen.length = 0;
    view.rerender();
    expect(seen[0]).toBe('loading');
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(2);
    expect(fakes.realtime.subscriptions[0].grant.channel).toBe('fixture:fake-singles');
    expect(fakes.realtime.subscriptions[0].open).toBe(false);
  });
});
