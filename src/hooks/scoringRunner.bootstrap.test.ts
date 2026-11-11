import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import type { BootstrapSide } from '@/domain/scoring/wire';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// The bootstrap read again on a foreground and on a people sheet (S2-6 Task 3, ruling 181), through the real runner, the
// real reducer and the fake server. A re-read changes who is on the sheet and nothing else: a failed one never stops the
// queue, a late one is ignored, and a re-read in play never turns the pad into a card.

const FIXTURE = SINGLES_SEED.fixtureId;
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-02T09:00:00.000Z';
const PACE = 15_000;
const START: BadmintonTap = { kind: 'start', server: 'first' };
const RALLY: BadmintonTap = { kind: 'rally', side: 'first' };

const tap = (made: BadmintonTap, key: string): MatchEvent => ({
  kind: 'tap',
  tap: made,
  key,
  at: AT,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

async function rig(): Promise<{ fakes: FakePorts; runner: ScoringRunner }> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club', 'badminton');
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
  await runner.start();
  await flush();
  return { fakes, runner };
}

const held = (runner: ScoringRunner) => {
  const snapshot = runner.snapshot();
  if (snapshot.kind !== 'ready') throw new Error('not ready');
  return snapshot.state;
};
const homeNames = (runner: ScoringRunner): string[] =>
  held(runner).bootstrap?.sides.home?.members.map((m) => m.fullName) ?? [];
const pendingKeys = (runner: ScoringRunner): string[] =>
  held(runner).sync.queue.pending.map((item) => item.key);

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

/** The home side with one more player, as the organiser saved it on the web meanwhile. */
const withNewPlayer: BootstrapSide = {
  ...SINGLES_SEED.sides.home,
  name: 'A. Sharma / N. Newcomer',
  members: [...SINGLES_SEED.sides.home.members, { personId: 'p-new', fullName: 'N. Newcomer' }],
  lineup: [...SINGLES_SEED.sides.home.lineup, { personId: 'p-new', pairOrder: null }],
};

const back = async (fakes: FakePorts, afterMs: number): Promise<void> => {
  fakes.foreground.leave();
  await vi.advanceTimersByTimeAsync(afterMs);
  fakes.foreground.fire();
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a lineup changed on the web', () => {
  it('reaches the match on the foreground 15 s after the last read, and not before', async () => {
    const { fakes, runner } = await rig();
    expect(homeNames(runner)).toEqual(['A. Sharma']);
    fakes.scoring.setSide('home', withNewPlayer);
    await back(fakes, PACE - 2_000);
    expect(homeNames(runner)).toEqual(['A. Sharma']);
    await back(fakes, PACE);
    expect(homeNames(runner)).toEqual(['A. Sharma', 'N. Newcomer']);
  });

  it('reaches the match on a people sheet, paced as the foreground is', async () => {
    const { fakes, runner } = await rig();
    fakes.scoring.setSide('home', withNewPlayer);
    runner.dispatch({ kind: 'peopleSheet' });
    await flush();
    expect(homeNames(runner)).toEqual(['A. Sharma']);
    await vi.advanceTimersByTimeAsync(PACE);
    runner.dispatch({ kind: 'peopleSheet' });
    await flush();
    expect(homeNames(runner)).toEqual(['A. Sharma', 'N. Newcomer']);
  });

  it('a ledger naming a person the new sheet dropped still folds', async () => {
    const { fakes, runner } = await rig();
    runner.dispatch(tap(START, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    fakes.scoring.setSide('home', { ...withNewPlayer, members: [], lineup: [] });
    await back(fakes, PACE);
    expect(viewOf(held(runner)).kind).toBe('pad');
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
  });
});

describe('a re-read that goes wrong', () => {
  it('a 429 and an offline answer do not stop the queued taps from going', async () => {
    const { fakes, runner } = await rig();
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const real = fakes.scoring.bootstrap.bind(fakes.scoring);
    const read = vi
      .spyOn(fakes.scoring, 'bootstrap')
      .mockResolvedValueOnce({ kind: 'rateLimited', retryAfterMs: 5_000 })
      .mockResolvedValueOnce({ kind: 'offline' })
      .mockImplementation(real);
    await back(fakes, PACE);
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    await back(fakes, PACE);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingKeys(runner)).toEqual([]);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
  });

  it('an answer for a lower lastSeq is ignored', async () => {
    const { fakes, runner } = await rig();
    runner.dispatch(tap(START, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    const real = fakes.scoring.bootstrap.bind(fakes.scoring);
    await back(fakes, PACE);
    const tip = held(runner).bootstrap?.lastSeq;
    expect(tip).toBe(2);
    vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (link) => {
      const answer = await real(link);
      return answer.kind === 'ok'
        ? {
            kind: 'ok',
            bootstrap: {
              ...answer.bootstrap,
              lastSeq: 0,
              sides: { home: withNewPlayer, away: answer.bootstrap.sides.away },
            },
          }
        : answer;
    });
    await back(fakes, PACE);
    expect(held(runner).bootstrap?.lastSeq).toBe(2);
    expect(homeNames(runner)).toEqual(['A. Sharma']);
  });
});

describe('a re-read during play', () => {
  it('with taps queued leaves the pad a pad, and the taps queued', async () => {
    const { fakes, runner } = await rig();
    runner.dispatch(tap(START, 'k1'));
    await flush();
    fakes.scoring.goOffline(true);
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    fakes.scoring.goOffline(false);
    fakes.scoring.setSide('home', withNewPlayer);
    const append = vi.spyOn(fakes.scoring, 'append').mockResolvedValue({ kind: 'offline' });
    await back(fakes, PACE);
    expect(append).toHaveBeenCalled();
    expect(homeNames(runner)).toEqual(['A. Sharma', 'N. Newcomer']);
    const view = viewOf(held(runner));
    expect(view.kind === 'pad' && view.view.card).toBeNull();
    expect(pendingKeys(runner)).toContain('k2');
  });

  it('flips it to view only when the bootstrap’s status says the match is finalized', async () => {
    const { fakes, runner } = await rig();
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const real = fakes.scoring.bootstrap.bind(fakes.scoring);
    vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (link) => {
      const answer = await real(link);
      return answer.kind === 'ok'
        ? { kind: 'ok', bootstrap: { ...answer.bootstrap, status: 'finalized' } }
        : answer;
    });
    await back(fakes, PACE);
    const view = viewOf(held(runner));
    expect(view.kind === 'pad' && view.view.card).toEqual({ kind: 'viewOnly' });
  });
});
