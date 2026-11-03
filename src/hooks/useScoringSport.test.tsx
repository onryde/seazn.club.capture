import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsProvider } from '@/hooks/usePorts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { useBadmintonMatch } from '@/hooks/useBadmintonMatch';
import { useScoringSport } from '@/hooks/useScoringSport';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// The sport picker (plan S2-1 Task 11; owner ruling 38): which screen draws a saved match, before any sport's hook runs.
// Over the real runner, hub and fake server. Every expectation is a literal.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

function mount(fakes: FakePorts, options: { strict?: boolean; id?: string } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <PortsProvider ports={fakes.ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    );
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  }
  return renderHook(({ id }: { id: string }) => useScoringSport(id), {
    wrapper: Wrapper,
    initialProps: { id: options.id ?? FIXTURE },
  });
}

async function rig(sport: string | null = 'badminton'): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  if (sport !== null) await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, sport);
  return fakes;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('useScoringSport', () => {
  it('is loading until the first read lands, then names the sport the match is', async () => {
    const view = mount(await rig());
    expect(view.result.current).toEqual({ kind: 'loading', offline: false });
    await flush();
    expect(view.result.current).toEqual({ kind: 'sport', sportKey: 'badminton' });
  });

  it('says the same under StrictMode (the focus it takes is counted, taken twice and given back once)', async () => {
    const view = mount(await rig(), { strict: true });
    await flush();
    expect(view.result.current).toEqual({ kind: 'sport', sportKey: 'badminton' });
  });

  it('with no link saved is a link that is gone', async () => {
    const view = mount(await rig(null));
    await flush();
    expect(view.result.current).toEqual({ kind: 'linkGone' });
  });

  it('a queue file it cannot read is unreadable, naming the queue', async () => {
    const fakes = await rig();
    fakes.queueFiles.files.set(`${FIXTURE}.json`, '{ not json');
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unreadable', what: 'queue' });
  });

  it('a link it cannot read is unreadable, naming the link', async () => {
    const fakes = await rig();
    const get = fakes.kv.get.bind(fakes.kv);
    vi.spyOn(fakes.kv, 'get').mockImplementation(async (key) => {
      if (key.includes(FIXTURE)) throw new Error('the store did not answer');
      return get(key);
    });
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unreadable', what: 'link' });
  });

  it('a sport this build does not score is named, never opened as another sport', async () => {
    const fakes = await rig('tennis');
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    const view = mount(fakes);
    await flush();
    expect(view.result.current).toEqual({ kind: 'unsupportedSport', sportKey: 'tennis' });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('keeps one answer through a match: a rally redraws no screen the route picked', async () => {
    const fakes = await rig();
    const seen = new Set<unknown>();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <PortsProvider ports={fakes.ports}>
          <LanguageProvider>{children}</LanguageProvider>
        </PortsProvider>
      );
    }
    const view = renderHook(
      () => {
        const sport = useScoringSport(FIXTURE);
        const match = useBadmintonMatch(FIXTURE);
        seen.add(sport);
        return match;
      },
      { wrapper: Wrapper },
    );
    await flush();
    const pad = view.result.current;
    if (pad.kind !== 'pad') throw new Error('expected the pad');
    act(() => pad.actions.pickServer('first'));
    act(() => pad.actions.start());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const now = view.result.current;
    if (now.kind !== 'pad') throw new Error('expected the pad');
    act(() => now.actions.tapHalf('first'));
    await flush();
    // Loading, then the sport: two answers over a whole start and a rally, the second one object.
    expect(seen.size).toBe(2);
  });

  it('asked for another match, answers for that one', async () => {
    const view = mount(await rig());
    await flush();
    expect(view.result.current).toEqual({ kind: 'sport', sportKey: 'badminton' });
    view.rerender({ id: 'another-match' });
    await flush();
    expect(view.result.current).toEqual({ kind: 'linkGone' });
  });
});
