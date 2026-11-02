import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { createScoringRunner, type RunnerMode } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink, scoringLinkKey } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// A match keeps its sport with its link (owner, 2026-11-02: "pad per sport must"), so every runner, the headless sender
// included, opens it as that sport before any bootstrap. This build scores one sport; the table is given a second here,
// the made-up "first to 3" (`test/firstTo3Sport.ts`), so a send can show whose rules made it.

vi.mock('@/domain/scoring/sports', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/domain/scoring/sports')>();
  const { firstTo3 } = await import('../../test/firstTo3Sport');
  return {
    ...real,
    sportFor: (key: string) => (key === firstTo3.key ? firstTo3 : real.sportFor(key)),
  };
});

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-02T09:00:00.000Z';

const POINT: QueuedEvent = {
  key: 'k1',
  type: 'first3.point',
  payload: { side: 'first' },
  rulesVersion: 1,
  createdAt: AT,
  attempts: 0,
};

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

/** A match whose link was kept with `sportKey`, one point queued on it, and the server taking every tap. */
async function kept(sportKey: string): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, sportKey);
  await fakes.tapQueue.save({
    fixtureId: FIXTURE,
    label: 'Match 4',
    pending: [POINT],
    ownEventIds: [],
    dead: null,
  });
  vi.spyOn(fakes.scoring, 'append').mockResolvedValue({
    kind: 'accepted',
    seq: 1,
    eventId: 'ev-1',
    rulesVersion: 1,
  });
  return fakes;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AT));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a match kept as another sport', () => {
  it('is sent by the headless sender through that sport’s payload and engine epoch, never badminton’s', async () => {
    const fakes = await kept('first3');
    const idle = vi.fn();
    const runner = createScoringRunner(fakes.ports, {
      fixtureId: FIXTURE,
      mode: 'headless',
      onIdle: idle,
    });
    await runner.start();
    await flush();
    expect(vi.mocked(fakes.scoring.append).mock.calls).toEqual([
      [
        LINK,
        FIXTURE,
        expect.objectContaining({
          type: 'first3.point',
          payload: { side: 'first', seen: 0 },
          engine_epoch: 7,
          idempotency_key: 'k1',
        }),
      ],
    ]);
    expect((await fakes.tapQueue.load(FIXTURE))?.pending).toEqual([]);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it.each<RunnerMode>(['focused', 'headless'])(
    'opens, %s, as the sport its link names, before any bootstrap is read',
    async (mode) => {
      const fakes = await kept('first3');
      const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
      fakes.scoring.goOffline(true);
      const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode });
      await runner.start();
      await flush();
      const snapshot = runner.snapshot();
      expect(snapshot.kind === 'ready' ? snapshot.state.sport.key : snapshot.kind).toBe('first3');
      expect(snapshot.kind === 'ready' ? snapshot.state.sync.engineEpoch : null).toBe(7);
      expect(bootstrap.mock.calls.length).toBe(mode === 'focused' ? 1 : 0);
    },
  );

  it('kept before the sport was (no sport in the link) is badminton’s, as every match then was', async () => {
    const fakes = await kept('first3');
    await fakes.kv.set(scoringLinkKey(FIXTURE), JSON.stringify(LINK));
    const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'headless' });
    await runner.start();
    await flush();
    const snapshot = runner.snapshot();
    expect(snapshot.kind === 'ready' ? snapshot.state.sport.key : snapshot.kind).toBe('badminton');
  });
});

describe('a match kept as a sport this build does not score', () => {
  it.each<RunnerMode>(['focused', 'headless'])(
    'says so, %s, and reads, sends and changes nothing',
    async (mode) => {
      const fakes = await kept('tennis');
      const reads = [
        vi.spyOn(fakes.scoring, 'bootstrap'),
        vi.spyOn(fakes.scoring, 'events'),
        vi.spyOn(fakes.scoring, 'rules'),
      ];
      const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode });
      await runner.start();
      await flush();
      expect(runner.snapshot()).toEqual({ kind: 'unsupportedSport', sportKey: 'tennis' });
      expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0]);
      expect(fakes.scoring.append).not.toHaveBeenCalled();
      expect((await fakes.tapQueue.load(FIXTURE))?.pending).toEqual([POINT]);
      expect(runner.dispatch({ kind: 'read' })).toBeNull();
    },
  );
});
