import { foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { badminton } from '@seazn/engine/sports/setbased';

/**
 * R4 (decision record; design §6.2): how long `@seazn/engine` takes to fold a whole badminton match on the phone.
 * The O9 check proved the engine bundles; this times it running. A made-up ledger, as the phone will hold it: a
 * decided best-of-3, the home side winning 21–15 21–18, so `core.start` and 75 rallies, 76 events. Folded strictly
 * (every event validated, which is what the phone's own queued taps get), so the number is the heavier path.
 * S2-2 and later sports repeat the probe with their own ledgers.
 */

const HOME = 'probe-home';
const AWAY = 'probe-away';
const FIXTURE = 'probe-fixture';
/** A fixed start and 20 s a rally, so two calls give the same ledger. */
const STARTED_AT_MS = Date.parse('2026-11-01T10:00:00.000Z');
const RALLY_MS = 20_000;
/** Each game's points, home first. Neither reaches 20-all, so each game ends on home's 21st point. */
const GAMES: readonly (readonly [home: number, away: number])[] = [
  [21, 15],
  [21, 18],
];
/** A value at or below the first seq makes the whole stream strict (`FoldOptions.strictFromSeq`). */
const STRICT = { strictFromSeq: 1 } as const;

const LINEUPS: LineupPair = {
  home: { entrantId: HOME, slots: [{ personId: `${HOME}-1`, slot: 'starting', orderNo: 1 }] },
  away: { entrantId: AWAY, slots: [{ personId: `${AWAY}-1`, slot: 'starting', orderNo: 1 }] },
};

/** The badminton defaults (best of 3, to 21, two clear, cap 30), read once, through the engine's own schema. */
const CFG = badminton.configSchema.parse({});

type Side = typeof HOME | typeof AWAY;

/** A game's rally winners in order: the two sides in turn until the away side has its points, then home's rest. */
function gameWinners([home, away]: readonly [number, number]): Side[] {
  const level = Array.from({ length: away }, (): Side[] => [HOME, AWAY]).flat();
  return [...level, ...Array.from({ length: home - away }, (): Side => HOME)];
}

function envelope(seq: number, type: string, payload: object): EventEnvelope {
  return {
    id: `probe-${seq}`,
    fixtureId: FIXTURE,
    seq,
    type,
    payload,
    recordedAt: new Date(STARTED_AT_MS + seq * RALLY_MS).toISOString(),
    recordedBy: null,
  };
}

/** The probe's ledger, built afresh on every call. Design §7.3: only the match's first rally names the server. */
export function syntheticBadmintonMatch(): readonly EventEnvelope[] {
  const rallies = GAMES.flatMap(gameWinners).map((wonBy, i) =>
    envelope(i + 2, 'badminton.rally', i === 0 ? { wonBy, serving: HOME } : { wonBy }),
  );
  return [envelope(1, 'core.start', {}), ...rallies];
}

export type TimedFold = { readonly events: number; readonly ms: readonly number[] };

/**
 * Folds `events` strictly `times` times and times each fold on its own: `ms[i]` is the clock just after fold `i`
 * less the clock just before it. A fold the engine refuses throws: a refusal is not a time.
 */
export function timeFold(
  events: readonly EventEnvelope[],
  times: number,
  now: () => number = () => performance.now(),
): TimedFold {
  const ms: number[] = [];
  for (let run = 0; run < times; run += 1) {
    const start = now();
    foldMatch(badminton, CFG, LINEUPS, events, STRICT);
    ms.push(now() - start);
  }
  return { events: events.length, ms };
}

/** What the probe shows and records: the fastest, median and slowest fold, and the first, which pays any warm-up. */
export type FoldReading = {
  readonly events: number;
  readonly runs: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
  readonly first: number;
};

/** The reading of a timed fold; null when nothing was folded. An even count's median is its two middle folds' mean. */
export function foldReading({ events, ms }: TimedFold): FoldReading | null {
  if (ms.length === 0) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    events,
    runs: ms.length,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    first: ms[0],
  };
}
