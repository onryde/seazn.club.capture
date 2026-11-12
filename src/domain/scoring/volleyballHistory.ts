import type { PadHistoryGroup, PadSide, PadText, PadVar } from '@/domain/scoring/padView';
import { setBasedHistory, type SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';
import { scoreText, sideNames } from '@/domain/scoring/setBasedSides';
import type {
  VolleyballDisplay,
  VolleyballDone,
  VolleyballPadKey,
  VolleyballPerson,
  VolleyballSanctionLevel,
} from '@/domain/scoring/volleyballTypes';

type Text = PadText<VolleyballPadKey>;

/**
 * One entry on the match's sheet as whoever keeps the score recorded it (S2's ledger fold): what it did then, the set it
 * was recorded in, each side's points after it, whether this phone recorded it, whether Undo took it back, and whether it
 * is this phone's tap still on its way to the server (design §6.4).
 */
export type VolleyballHistoryEntry = SetBasedHistoryEntry<VolleyballDone>;

/**
 * History (owner ruling 21; view only; S2-6 ruling 183), the same shape as table tennis's: the entries grouped by the set
 * they were recorded in, the latest set first, each set's newest entry first, an entry Undo took back in its place. A point
 * gives the score after it, top first; a timeout, a sub, a sanction and a set score (its sentence says the score) give none.
 */
export function volleyballHistory(
  entries: readonly VolleyballHistoryEntry[],
  sides: VolleyballDisplay['sides'],
): readonly PadHistoryGroup<VolleyballPadKey>[] {
  return setBasedHistory<VolleyballDone, VolleyballPadKey>(entries, {
    heading: (set) => ({ key: 'scoring.volleyball.setHeading', vars: { set } }),
    said: (did) => doneSaid(sides, did),
    scored: (did) => did.kind === 'rally',
  });
}

/** A sanction level's word (the generic ladder's: Warning, Penalty, Expulsion, Disqualification). */
export const levelWord = (level: VolleyballSanctionLevel): Text => ({
  key: `scoring.sanction.${level}`,
});

/** A person as typed, or "Player" for one the sheet no longer lists: never blank (ruling 183). */
export const personWord = (person: VolleyballPerson): PadVar<VolleyballPadKey> =>
  person.name ?? { key: 'scoring.volleyball.player' };

/**
 * What a tap did, in the last-tap line's words ("Point recorded — Falcons"): the line says it of the last tap, and History
 * of every tap, in the one vocabulary. A sub names who went off and on when it has both ("Sub · Falcons: A → B"), else the
 * side; the deciding set's first rally says who served first.
 */
export function doneSaid(sides: VolleyballDisplay['sides'], tap: VolleyballDone): Text {
  const side = (of: PadSide) => sideNames(sides[of]);
  switch (tap.kind) {
    case 'start':
      return tap.server === null
        ? { key: 'scoring.volleyball.last.startUnknownServer' }
        : { key: 'scoring.volleyball.last.start', vars: { side: side(tap.server) } };
    case 'rally':
      return rallySaid(sides, tap);
    case 'timeout':
      return { key: 'scoring.volleyball.last.timeout', vars: { side: side(tap.side) } };
    case 'sub':
      return subSaid(side(tap.side), tap.off, tap.on);
    case 'sanction':
      return {
        key: 'scoring.volleyball.last.sanction',
        vars: {
          level: levelWord(tap.level),
          person: tap.person === null ? side(tap.side) : personWord(tap.person),
        },
      };
    case 'setScore':
      return { key: 'scoring.volleyball.last.setScore', vars: { score: scoreText(tap) } };
  }
}

function subSaid(side: string, off: VolleyballPerson | null, on: VolleyballPerson | null): Text {
  if (off === null || on === null) return { key: 'scoring.volleyball.last.sub', vars: { side } };
  return {
    key: 'scoring.volleyball.last.subNamed',
    vars: { side, off: personWord(off), on: personWord(on) },
  };
}

/** A point: who won it, whether it won a set or the match, and, when it answered the toss, who served first. */
function rallySaid(
  sides: VolleyballDisplay['sides'],
  tap: Extract<VolleyballDone, { readonly kind: 'rally' }>,
): Text {
  const side = sideNames(sides[tap.side]);
  const point = pointSaid(side, tap);
  if (tap.toss === null) return point;
  return {
    key: 'scoring.volleyball.last.toss',
    vars: { point, serving: sideNames(sides[tap.toss]) },
  };
}

function pointSaid(side: string, tap: Extract<VolleyballDone, { readonly kind: 'rally' }>): Text {
  if (tap.won === 'game') {
    return { key: 'scoring.volleyball.last.set', vars: { set: tap.set, side } };
  }
  const key =
    tap.won === 'match' ? 'scoring.volleyball.last.match' : 'scoring.volleyball.last.rally';
  return { key, vars: { side } };
}
