import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsProvider } from '@/hooks/usePorts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { useScoringMatch } from '@/hooks/useScoringMatch';
import { SINGLES_SEED, createFakeScoringPort } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { SINGLES } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// The match hook (plan S2-1 Task 9): what the pad screen is drawn from, over the real runner, hub, queue store and
// reducer, and the fake server. Copy is keys here (Task 11 draws the words); every expectation is a literal.

const FIXTURE = SINGLES_SEED.fixtureId;
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
  return renderHook(() => useScoringMatch(id), { wrapper: Wrapper });
}

async function rig(over: Parameters<typeof createFakePorts>[0] = {}): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, ...over });
  await saveScoringLink(fakes.kv, FIXTURE, LINK);
  return fakes;
}

type Pad = Extract<ReturnType<typeof useScoringMatch>, { kind: 'pad' }>;
function pad(match: ReturnType<typeof useScoringMatch>): Pad {
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
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
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
    await saveScoringLink(fakes.kv, 'm-other', LINK);
    let id = FIXTURE;
    const seen: string[] = [];
    const view = renderHook(
      () => {
        const match = useScoringMatch(id);
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
