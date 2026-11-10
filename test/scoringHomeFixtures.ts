import { encodeSavedCode } from '@/domain/mode/savedCode';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import type { MatchQueue, QueueDead } from '@/domain/scoring/queue';
import { STORE_KEYS } from '@/services/modeStore';
import type { ScoringLink } from '@/services/scoringPort';
import { SINGLES, ledgerOf, queuedOf, rally, type Spec } from './badmintonLedger';
import { TEST_NOW, type FakePorts } from './fakePorts';

/** A made-up scoring token: nothing real is ever a fixture (AGENTS: no real codes in tests). */
export const TOKEN = 'dl_madeUpTokenForHomeTests01';
export const RAW = `https://stg.seazn.club/score/${TOKEN}`;
export const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: TOKEN };
/** A link as the secure store keeps it: with its match's sport (a link with none reads as no link). */
export const STORED_LINK = JSON.stringify({ ...LINK, sportKey: 'badminton' });

/** The fake server's match (`SINGLES_SEED`): what a bootstrap on the fake names, and what Home calls it. */
export const FAKE_MATCH = 'fake-singles';
export const FAKE_LABEL = 'Match 4';

export const linkKey = (fixtureId: string) => `scoring.link.${fixtureId}`;

/** A queue holding `taps` rallies, as the disk would after that many taps. */
export function queueHolding(
  fixtureId: string,
  taps: number,
  over: { label?: string; dead?: QueueDead | null; askedAbout?: readonly string[] } = {},
): MatchQueue {
  return {
    fixtureId,
    label: over.label ?? `Label of ${fixtureId}`,
    pending: Array.from({ length: taps }, (_, i) => queuedOf(`${fixtureId}-k${i}`, rally('H'))),
    ownEventIds: [],
    dead: over.dead ?? null,
    ...(over.askedAbout === undefined ? {} : { askedAbout: over.askedAbout }),
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
    await fakes.kv.set(
      linkKey(queue.fixtureId),
      JSON.stringify({ ...link, sportKey: 'badminton' }),
    );
  }
}

/**
 * What a pad that scored a match leaves on the phone besides its queue: the ledger from seq 1 and the bootstrap last
 * read (`in_play` unless said), under the match's own id. A reopened app finds the match as these say it stands.
 */
export async function leaveHistory(
  fakes: Pick<FakePorts, 'tapQueue'>,
  fixtureId: string,
  specs: readonly Spec[],
  over: { status?: string; viewOnlyReason?: string } = {},
): Promise<void> {
  await fakes.tapQueue.saveLedger(fixtureId, ledgerOf(specs));
  // A reason is the web's View-only screen (scan-screen.ts): `carried_forward`, `no_opponent`, ...
  const viewOnly =
    over.viewOnlyReason === undefined
      ? {}
      : { screen: 'viewOnly' as const, viewOnlyReason: over.viewOnlyReason };
  await fakes.tapQueue.saveBoot(fixtureId, {
    bootstrap: { ...SINGLES, fixtureId, status: over.status ?? 'in_play', ...viewOnly },
    toss: null,
    picks: NO_PICKS,
  });
}

/** The saved scoring code the secure store keeps for a match, as `modeStore` encodes it. */
export const savedMatch = (fixtureId = FAKE_MATCH, label = FAKE_LABEL): string =>
  encodeSavedCode({
    mode: 'scoring',
    raw: '',
    slot: null,
    savedAt: TEST_NOW,
    expiresAt: null,
    stream: null,
    scoring: { fixtureId, label },
  });

/** A launch that finds Remote Scoring active, a match saved and its link kept: the seed of the secure store. */
export const inMatch = (fixtureId = FAKE_MATCH, label = FAKE_LABEL): Record<string, string> => ({
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: savedMatch(fixtureId, label),
  [linkKey(fixtureId)]: STORED_LINK,
});
