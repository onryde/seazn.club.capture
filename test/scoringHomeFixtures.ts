import type { MatchQueue, QueueDead } from '@/domain/scoring/queue';
import type { ScoringLink } from '@/services/scoringPort';
import { queuedOf, rally } from './badmintonLedger';
import type { FakePorts } from './fakePorts';

/** A made-up scoring token: nothing real is ever a fixture (AGENTS: no real codes in tests). */
export const TOKEN = 'dl_madeUpTokenForHomeTests01';
export const RAW = `https://stg.seazn.club/score/${TOKEN}`;
export const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: TOKEN };

/** The fake server's match (`SINGLES_SEED`): what a bootstrap on the fake names, and what Home calls it. */
export const FAKE_MATCH = 'fake-singles';
export const FAKE_LABEL = 'Match 4';

export const linkKey = (fixtureId: string) => `scoring.link.${fixtureId}`;

/** A queue holding `taps` rallies, as the disk would after that many taps. */
export function queueHolding(
  fixtureId: string,
  taps: number,
  over: { label?: string; dead?: QueueDead | null } = {},
): MatchQueue {
  return {
    fixtureId,
    label: over.label ?? `Label of ${fixtureId}`,
    pending: Array.from({ length: taps }, (_, i) => queuedOf(`${fixtureId}-k${i}`, rally('H'))),
    ownEventIds: [],
    dead: over.dead ?? null,
  };
}

/** A queue file on the fake phone's disk, and the match's link in its secure store when `link` is given. */
export async function leave(
  fakes: Pick<FakePorts, 'tapQueue' | 'kv'>,
  queue: MatchQueue,
  link: ScoringLink | null = LINK,
): Promise<void> {
  await fakes.tapQueue.save(queue);
  if (link !== null) {
    await fakes.kv.set(linkKey(queue.fixtureId), JSON.stringify(link));
  }
}
