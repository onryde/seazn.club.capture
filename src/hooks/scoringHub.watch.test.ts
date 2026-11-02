import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scoringHubOf } from '@/hooks/scoringHub';
import { watchDeadLink } from '@/hooks/scoringDeadLink';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';

// The hub's hold on the dead-link watch (plan S2-1 Task 10): started with a focus, stopped with the last release and with
// a dismiss, never left running. The watch itself is `scoringDeadLink.test.ts`; here it is a recorder.

vi.mock('@/hooks/scoringDeadLink', () => ({ watchDeadLink: vi.fn() }));

const FIXTURE = SINGLES_SEED.fixtureId;
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(watchDeadLink).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function rig() {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club');
  const stop = vi.fn();
  vi.mocked(watchDeadLink).mockReturnValue(stop);
  return { fakes, stop };
}

describe('the hub and the dead-link watch', () => {
  it('starts one watch for a focused match, however many screens focus it', async () => {
    const { fakes } = await rig();
    const hub = scoringHubOf(fakes.ports);
    const first = hub.focus(FIXTURE);
    hub.focus(FIXTURE);
    await flush();
    expect(watchDeadLink).toHaveBeenCalledTimes(1);
    expect(vi.mocked(watchDeadLink).mock.calls[0]?.[1]).toBe(first.runner);
  });

  it('stops it with the last release, not before', async () => {
    const { fakes, stop } = await rig();
    const hub = scoringHubOf(fakes.ports);
    const first = hub.focus(FIXTURE);
    const second = hub.focus(FIXTURE);
    await flush();
    first.release();
    await flush();
    expect(stop).not.toHaveBeenCalled();
    second.release();
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops it when the match is dismissed while a screen still holds it', async () => {
    const { fakes, stop } = await rig();
    const hub = scoringHubOf(fakes.ports);
    hub.focus(FIXTURE);
    await flush();
    await hub.dismiss(FIXTURE);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
