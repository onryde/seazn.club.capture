import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  DOUBLES_NOAD_CFG,
  doublesSeed,
  GRAND_SLAM_CFG,
  HOME_ENTRANT,
  singlesSeed,
} from '@/services/fakeTennisPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// Two real finals replayed through the phone's scoring path (S2-7 Task 10; lesson L5: a real match, early). The seam is the
// hook, `useTennisMatch`, over the real runner, hub, queue store, sync, the engine fold and a fake server that judges every
// append with the engine alone: what a phone runs from a tap to the result card.
//
// SOURCES (set scores as played; written from the implementer's own knowledge, NOT fetched: no network read was made):
//  - Singles, Grand Slam: Australian Open 2022 men's final, 30 January 2022, Rod Laver Arena: Rafael Nadal d. Daniil
//    Medvedev 2-6, 6-7(5), 6-4, 6-4, 7-5. Confidence: high for the set scores and the second set's tie-break at 7-5.
//    https://en.wikipedia.org/wiki/2022_Australian_Open_%E2%80%93_Men%27s_singles
//  - Doubles, tour format: Tokyo 2020 Olympic men's doubles final, 30 July 2021: Nikola Mektic / Mate Pavic (CRO) d. Marin
//    Cilic / Ivan Dodig (CRO) 6-4, 3-6, [10-6]. Confidence: high for the score; LOW that that event scored its games no-ad
//    (the ATP tour's doubles do, with a 10-point match tie-break at one set all, and that is the format under test here).
//    https://en.wikipedia.org/wiki/Tennis_at_the_2020_Summer_Olympics_%E2%80%93_Men%27s_doubles
//
// SYNTHETIC: only the set scores are real. The order of points inside a game and of games inside a set (the games alternate
// until the loser has enough, with one deuce game built to reach advantage three times), every player's id and every
// server are made up or the engine's; no point-by-point record was used. The expected values are the published scores and
// the rules' own words, never computed by the code under test (AGENTS §10).

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const REPLAY_TIMEOUT = 180_000;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Pad = Extract<ReturnType<typeof useTennisMatch>, { kind: 'pad' }>;
type Hook = ReturnType<typeof renderHook<ReturnType<typeof useTennisMatch>, unknown>>;

const padOf = (view: Hook): Pad => {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
};

const SIDE_OF = { H: 'first', A: 'second' } as const satisfies Record<string, PadSide>;

class Scorer {
  refusals = 0;
  /** The call (0, 15, 30, 40, AD) of each side after every point of the game just tapped. */
  calls: Array<readonly [string, string]> = [];
  constructor(
    readonly fakes: FakePorts,
    readonly view: Hook,
    readonly seed: FakeMatchSeed,
  ) {}

  get pad(): Pad {
    return padOf(this.view);
  }

  async press(make: (actions: Pad['actions']) => void): Promise<void> {
    act(() => make(this.pad.actions));
    await flush();
    await wait(300);
    if (this.pad.line?.kind === 'refusal') this.refusals += 1;
  }

  async ledger(): Promise<readonly LedgerEvent[]> {
    const events = await this.fakes.scoring.events(LINK, this.seed.fixtureId, 0);
    return Array.isArray(events) ? events : [];
  }

  /** The points of one game or breaker, one letter each: H to the first side, A to the second. */
  async points(winners: string): Promise<void> {
    for (const letter of winners) {
      const side = SIDE_OF[letter as 'H' | 'A'];
      await this.press((a) => a.tapHalf(side));
      const { halves } = this.pad.view;
      this.calls.push([halves[0].value, halves[1].value]);
    }
  }

  /** A love game each, one letter a game. */
  async games(winners: string): Promise<void> {
    for (const letter of winners) await this.points(letter.repeat(4));
  }

  /** The side the pad shows the serve ball on, or null. */
  get server(): PadSide | null {
    const { halves } = this.pad.view;
    if (halves[0].serving !== null) return 'first';
    return halves[1].serving !== null ? 'second' : null;
  }
}

async function opened(seed: FakeMatchSeed): Promise<Scorer> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'tennis');
  const view = renderHook(() => useTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait(1_000);
  const scorer = new Scorer(fakes, view, seed);
  await scorer.press((a) => a.start());
  return scorer;
}

/** The seed with its players' names as the published draw has them (the pad names a side by its players). */
const named = (
  seed: FakeMatchSeed,
  home: readonly string[],
  away: readonly string[],
): FakeMatchSeed => {
  const rename = (side: FakeMatchSeed['sides']['home'], names: readonly string[]) => ({
    ...side,
    members: side.members.map((member, i) => ({
      ...member,
      fullName: names[i] ?? member.fullName,
    })),
  });
  return {
    ...seed,
    sides: { home: rename(seed.sides.home, home), away: rename(seed.sides.away, away) },
  };
};

const typesIn = (ledger: readonly LedgerEvent[], type: string) =>
  ledger.filter((event) => event.type === type);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T09:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The headline of the recorded result's card: a failed test, not a type to narrow, when the card is another kind. */
const titleOf = (card: Pad['view']['card']) => {
  if (card?.kind !== 'resultRecorded')
    throw new Error(`expected the result card, got ${card?.kind}`);
  return card.title;
};

const pendingOf = (fakes: FakePorts, fixtureId: string) => {
  const queue = fakes.queueFiles.files.get(`${fixtureId}.json`);
  return queue === undefined ? 0 : (JSON.parse(queue).pending as unknown[]).length;
};

describe('the Australian Open 2022 men’s final: Nadal 3-2 Medvedev', () => {
  it(
    'every set ends at its published score, the match is Nadal’s, and nothing is refused or left unsent',
    async () => {
      const seed = named(
        singlesSeed({ fixtureId: 'replay-ao-2022', cfg: GRAND_SLAM_CFG }),
        ['R. Nadal'],
        ['D. Medvedev'],
      );
      const scorer = await opened(seed);

      // Set 1, 2-6 (Medvedev): eight love games.
      await scorer.games('AAHAAHAA');
      expect(scorer.pad.view.tally?.shown).toBe('0:1');

      // Set 2, 6-7(5): the games alternate to 6-6, then a tie-break Medvedev takes 7-5.
      await scorer.games('HAHAHAHAHAHA');
      const keysOf = () => scorer.pad.view.strip.map((item) => item.text?.key);
      expect(keysOf()).toContain('scoring.tennis.breaker.tiebreak');
      const firstOfBreaker = scorer.server;
      await scorer.points('H');
      await scorer.points('AHAHAHAHAAA');
      expect(scorer.pad.view.tally?.shown).toBe('0:2');

      // ITF rule 5: whoever served first in a tie-break receives first in the next set. In this construction Nadal (the first side, whom the engine
      // has serve first) served the games of the odd numbers, so he served the tie-break's first point and Medvedev serves the next set's first game.
      expect(firstOfBreaker).toBe('first');
      expect(scorer.server).toBe('second');

      // Set 3, 6-4 (Nadal): the fifth game goes to deuce and advantage three times (first, second, first) before Nadal's.
      await scorer.games('HHAA');
      scorer.calls = [];
      await scorer.points('HAHAHAHAAHHH');
      const advantages = scorer.calls.flatMap(([top, bottom]) =>
        top === 'AD' ? ['first'] : bottom === 'AD' ? ['second'] : [],
      );
      expect(advantages).toEqual(['first', 'second', 'first']);
      await scorer.games('HAAHH');
      expect(scorer.pad.view.tally?.shown).toBe('1:2');

      await scorer.games('AHHAHHAAHH');
      await scorer.games('HAHAHAHAHAHH');
      await wait(5_000);

      const { view } = scorer.pad;
      expect(view.tally?.shown).toBe('3:2');
      expect(view.card?.kind).toBe('resultRecorded');
      expect(titleOf(view.card)).toEqual({
        key: 'scoring.tennis.result',
        vars: { side: 'R. Nadal', sets: '2–6 6–7(5) 6–4 6–4 7–5' },
      });
      expect(scorer.refusals).toBe(0);
      expect(pendingOf(scorer.fakes, 'replay-ao-2022')).toBe(0);

      // What the server holds: 32 + 60 + 48 + 40 + 48 points, and not one of them a set score.
      const ledger = await scorer.ledger();
      expect(typesIn(ledger, 'tennis.point')).toHaveLength(228);
      expect(typesIn(ledger, 'tennis.set_summary')).toHaveLength(0);
      expect(typesIn(ledger, 'core.start')).toHaveLength(1);
    },
    REPLAY_TIMEOUT,
  );
});

describe('the Tokyo 2020 Olympic men’s doubles final: Mektic / Pavic 2-1 Cilic / Dodig', () => {
  it(
    'a no-ad game ends on its deciding point at 40-40, and the match tie-break is [10-6]',
    async () => {
      const seed = named(
        doublesSeed({ fixtureId: 'replay-tokyo-doubles', cfg: DOUBLES_NOAD_CFG }),
        ['N. Mektic', 'M. Pavic'],
        ['M. Cilic', 'I. Dodig'],
      );
      const scorer = await opened(seed);

      // Set 1, 6-4 (Mektic / Pavic): the first game goes to 40-40 and one deciding point, the first side's.
      await scorer.points('HAHAHA');
      expect(scorer.pad.view.halves.map((half) => half.value)).toEqual(['40', '40']);
      expect(scorer.pad.view.strip.map((item) => item.text?.key)).toContain(
        'scoring.tennis.note.decidingPoint',
      );
      await scorer.points('H');
      expect(scorer.pad.view.halves.map((half) => half.foot?.text.vars)).toEqual([
        { games: 1 },
        { games: 0 },
      ]);
      await scorer.games('HAAHHAAHH');
      expect(scorer.pad.view.tally?.shown).toBe('1:0');

      // Set 2, 3-6 (Cilic / Dodig): one game to the first side's three, the second's six.
      await scorer.games('AHAHAHAAA');
      expect(scorer.pad.view.tally?.shown).toBe('1:1');

      // The deciding set is a match tie-break to 10, [10-6]: the sides alternate to 6-6, then the first side runs four out.
      await scorer.points('HAHAHAHAHAHA');
      expect(scorer.pad.view.strip.map((item) => item.text?.key)).toContain(
        'scoring.tennis.breaker.matchTiebreak',
      );
      await scorer.points('HHHH');
      await wait(5_000);

      const { view } = scorer.pad;
      expect(view.tally?.shown).toBe('2:1');
      expect(titleOf(view.card)).toEqual({
        key: 'scoring.tennis.result',
        vars: { side: 'N. Mektic / M. Pavic', sets: '6–4 3–6 [10–6]' },
      });
      expect(scorer.refusals).toBe(0);
      expect(pendingOf(scorer.fakes, 'replay-tokyo-doubles')).toBe(0);
      const ledger = await scorer.ledger();
      // 7 points in set 1's first game and 36 in its nine love games, 36 in set 2's nine, 16 in the tie-break.
      expect(typesIn(ledger, 'tennis.point')).toHaveLength(7 + 36 + 36 + 16);
      expect(typesIn(ledger, 'tennis.point')[0]?.payload).toMatchObject({ by: HOME_ENTRANT });
    },
    REPLAY_TIMEOUT,
  );
});
