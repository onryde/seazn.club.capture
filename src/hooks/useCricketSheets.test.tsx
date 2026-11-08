import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { liveCricketSeed } from '@/services/fakeCricketPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The cricket sheets that go step by step (S2-4 plan Task 11): which step shows, what a choice on it does, and the
// bounce windows around them, through the match's hook over the fake server (the real runner and fold). The keys and
// the sheet as drawn are `CricketKeys.test.tsx`'s and `CricketSheets.test.tsx`'s.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const LIVE = liveCricketSeed();

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function opened() {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: LIVE });
  await saveScoringLink(fakes.kv, LIVE.fixtureId, LINK, 'stg.seazn.club', 'cricket');
  const view = renderHook(() => useCricketMatch(LIVE.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait();
  return { fakes, view };
}

type View = Awaited<ReturnType<typeof opened>>['view'];

function pad(view: View) {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

/** The step on screen, by name, or none. */
function stepName(view: View): string | null {
  const sheet = pad(view).sheet;
  return sheet?.kind === 'step' ? sheet.step.name : null;
}

/** The choices of the step on screen. */
function stepOptions(view: View) {
  const sheet = pad(view).sheet;
  return sheet?.kind === 'step' ? sheet.step.options : [];
}

async function count(fakes: FakePorts) {
  const events = await fakes.scoring.events(LINK, LIVE.fixtureId, 0);
  return Array.isArray(events) ? events.length : -1;
}

describe('useCricketSheets', () => {
  it('an extra’s key opens its step; a choice on the heels of it is ignored, a later one records and closes', async () => {
    const { fakes, view } = await opened();
    const before = await count(fakes);
    act(() => pad(view).actions.openExtras('wide'));
    expect(stepName(view)).toBe('extras.wide');
    act(() => pad(view).actions.choose('ran.1'));
    await flush();
    expect([stepName(view), await count(fakes)]).toEqual(['extras.wide', before]);
    await wait();
    act(() => pad(view).actions.choose('ran.1'));
    await flush();
    expect([stepName(view), await count(fakes)]).toEqual([null, before + 1]);
    expect(pad(view).board.score?.runs).toBe(7);
  });

  it('a choice the step does not offer does nothing and leaves it open', async () => {
    const { fakes, view } = await opened();
    const before = await count(fakes);
    act(() => pad(view).actions.openExtras('bye'));
    await wait();
    act(() => pad(view).actions.choose('ran.0'));
    await flush();
    expect([stepName(view), await count(fakes)]).toEqual(['extras.bye', before]);
  });

  it('Cancel records nothing; nor does Back, the phone’s', async () => {
    const { fakes, view } = await opened();
    const before = await count(fakes);
    act(() => pad(view).actions.openExtras('noball'));
    await wait();
    act(() => pad(view).actions.dismiss());
    expect(stepName(view)).toBeNull();
    await wait();
    act(() => pad(view).actions.openExtras('noball'));
    await wait();
    act(() => void fakes.back.press());
    await flush();
    expect([stepName(view), await count(fakes)]).toEqual([null, before]);
  });

  it('+ Out moves the sheet on to the wicket’s step, named apart, so a choice on its heels is ignored', async () => {
    const { fakes, view } = await opened();
    const before = await count(fakes);
    act(() => pad(view).actions.openExtras('wide'));
    await wait();
    act(() => pad(view).actions.choose('out'));
    expect(stepName(view)).toBe('wicket.kind');
    act(() => pad(view).actions.choose('stumped'));
    await flush();
    expect([stepName(view), await count(fakes)]).toEqual(['wicket.kind', before]);
  });

  it('Out from the wide sheet records one ball: the wide and the stumping together', async () => {
    const { fakes, view } = await opened();
    const before = await count(fakes);
    act(() => pad(view).actions.openExtras('wide'));
    for (const id of ['out', 'stumped']) {
      await wait();
      act(() => pad(view).actions.choose(id));
    }
    const keeper = stepOptions(view);
    expect([stepName(view), keeper.length]).toEqual(['wicket.fielder', 1]);
    await wait();
    act(() => pad(view).actions.choose(keeper[0]!.id));
    const incoming = stepOptions(view).find((one) => one.chosen === true);
    expect(stepName(view)).toBe('wicket.incoming');
    await wait();
    act(() => pad(view).actions.choose(incoming!.id));
    await flush();
    const events = await fakes.scoring.events(LINK, LIVE.fixtureId, 0);
    if (!Array.isArray(events)) throw new Error('no events');
    expect([stepName(view), events.length]).toEqual([null, before + 1]);
    expect(events.at(-1)?.payload).toMatchObject({
      runs: { bat: 0, extras: { kind: 'wide', runs: 1 } },
      wicket: {
        kind: 'stumped',
        fielder: keeper[0]!.id,
        incoming: incoming!.id,
        bowlerCredited: true,
      },
    });
  });

  it('a key on the heels of a recorded ball is its second touch: no sheet, and the line says Counted once', async () => {
    const { view } = await opened();
    act(() => pad(view).actions.openExtras('wide'));
    await wait();
    act(() => pad(view).actions.choose('ran.0'));
    act(() => pad(view).actions.openOut());
    await flush();
    expect(stepName(view)).toBeNull();
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act(() => pad(view).actions.openOut());
    expect(stepName(view)).toBe('wicket.kind');
  });
});
