import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { useVolleyballMatch } from '@/hooks/useVolleyballMatch';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  beachSeed,
  ENTRANT_OF,
  HOME_ENTRANT,
  indoorSeed,
} from '@/services/fakeVolleyballPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// Two real finals replayed through the phone's scoring path (S2-6 Task 10; lesson L5: a real match, early). The seam is the
// hook, `useVolleyballMatch`, over the real runner, hub, queue store, sync, the engine fold and a fake server that judges
// every append with the engine alone: what a phone runs from a tap to History.
//
// SOURCES (set scores as played; Wikipedia's tournament pages, read 2026-11-11):
//  - Indoor: Tokyo 2020 Olympic men's final, 7 August 2021, Ariake Arena: France 3-2 ROC, 25-23, 25-17, 21-25, 21-25, 15-12.
//    https://en.wikipedia.org/wiki/Volleyball_at_the_2020_Summer_Olympics_%E2%80%93_Men%27s_tournament
//  - Beach: Tokyo 2020 Olympic men's final, 7 August 2021: Norway (Mol / Sorum) 2-0 ROC (Krasilnikov / Stoyanovskiy),
//    21-17, 21-18.
//    https://en.wikipedia.org/wiki/Beach_volleyball_at_the_2020_Summer_Olympics_%E2%80%93_Men%27s_tournament
//
// SYNTHETIC: only the set scores are real. The order of rallies inside a set (the sides alternate until the loser has
// scored, then the winner runs out the set), the players' names and ids, and every timeout, substitution and sanction and
// the minute they are placed at are made up for the test; no point-by-point record or team sheet was used. The expected
// values are the published scores and the placements below, never computed by the code under test (AGENTS §10).

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

type Pad = Extract<ReturnType<typeof useVolleyballMatch>, { kind: 'pad' }>;
type Hook = ReturnType<typeof renderHook<ReturnType<typeof useVolleyballMatch>, unknown>>;

const padOf = (view: Hook): Pad => {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
};

/** One thing the scorer does inside a set, after `after` rallies of it. */
type Placed =
  | { readonly after: number; readonly timeout: PadSide }
  | { readonly after: number; readonly sub: PadSide; readonly off: number; readonly on: number }
  | { readonly after: number; readonly warning: PadSide; readonly person: number }
  | { readonly after: number; readonly penalty: PadSide; readonly person: number };

/** A set as played: its final score, who took it, and what the scorer placed inside it. */
type Played = {
  readonly home: number;
  readonly away: number;
  readonly placed?: readonly Placed[];
};

/** The sides' rallies in a set: alternate until the loser has scored, then the winner runs out the set. */
function ralliesOf({ home, away }: Played): PadSide[] {
  const winner: PadSide = home > away ? 'first' : 'second';
  const loser: PadSide = winner === 'first' ? 'second' : 'first';
  const [w, l] = winner === 'first' ? [home, away] : [away, home];
  const order: PadSide[] = [];
  for (let i = 0; i < l; i += 1) order.push(winner, loser);
  while (order.filter((side) => side === winner).length < w) order.push(winner);
  return order;
}

type Counts = { refusals: number; ledgerTaps: number };

class Scorer {
  readonly counts: Counts = { refusals: 0, ledgerTaps: 0 };
  constructor(
    readonly fakes: FakePorts,
    readonly view: Hook,
    readonly seed: FakeMatchSeed,
  ) {}

  get pad(): Pad {
    return padOf(this.view);
  }

  /** A press, then the wait that takes its bounce window away; a refusal on the line is counted. */
  async press(make: (actions: Pad['actions']) => void): Promise<void> {
    act(() => make(this.pad.actions));
    await flush();
    await wait(300);
    if (this.pad.line?.kind === 'refusal') this.counts.refusals += 1;
  }

  async ledger(): Promise<readonly LedgerEvent[]> {
    const events = await this.fakes.scoring.events(LINK, this.seed.fixtureId, 0);
    return Array.isArray(events) ? events : [];
  }

  async sideTimeout(side: PadSide): Promise<void> {
    await this.press((a) => a.tool('timeout'));
    await this.press((a) => a.choose(side));
  }

  async sub(side: PadSide, off: number, on: number): Promise<void> {
    const id = (n: number) => `${ENTRANT_OF[side]}-p${n}`;
    await this.press((a) => a.tool('sub'));
    await this.press((a) => a.choose(side));
    await this.press((a) => a.choose(id(off)));
    await this.press((a) => a.choose(id(on)));
  }

  async sanction(side: PadSide, level: string, person: number): Promise<void> {
    await this.press((a) => a.tool('more'));
    await this.press((a) => a.choose(`sanction.${side}`));
    await this.press((a) => a.choose(level));
    await this.press((a) => a.choose(`${ENTRANT_OF[side]}-p${person}`));
  }

  async place(placed: Placed): Promise<void> {
    if ('timeout' in placed) return this.sideTimeout(placed.timeout);
    if ('sub' in placed) return this.sub(placed.sub, placed.off, placed.on);
    if ('warning' in placed) return this.sanction(placed.warning, 'warning', placed.person);
    return this.sanction(placed.penalty, 'penalty', placed.person);
  }

  /**
   * Play a set: every rally a tap on its half, with what is placed inside it after its rally. The deciding set's first
   * tap asks who serves (ruling 180); `toss` answers it.
   */
  async play(set: Played, toss: PadSide | null = null): Promise<void> {
    const order = ralliesOf(set);
    for (let i = 0; i <= order.length; i += 1) {
      for (const placed of set.placed ?? []) if (placed.after === i) await this.place(placed);
      const side = order[i];
      if (side === undefined) break;
      await this.press((a) => a.tapHalf(side));
      if (toss !== null && i === 0) await this.press((a) => a.choose(toss));
    }
  }
}

async function opened(seed: FakeMatchSeed): Promise<Scorer> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'volleyball');
  const view = renderHook(() => useVolleyballMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait(1_000);
  return new Scorer(fakes, view, seed);
}

/** Start the match: the first side picked to serve, then Start match. */
async function start(scorer: Scorer, server: PadSide): Promise<void> {
  await scorer.press((a) => a.pickServer(server));
  await scorer.press((a) => a.start());
}

const named = (seed: FakeMatchSeed, home: string, away: string): FakeMatchSeed => ({
  ...seed,
  sides: {
    home: { ...seed.sides.home, name: home },
    away: { ...seed.sides.away, name: away },
  },
});

const typesIn = (ledger: readonly LedgerEvent[], type: string) =>
  ledger.filter((event) => event.type === type);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T09:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the Tokyo 2020 men’s final, indoor: France 3-2 ROC', () => {
  const SETS: readonly Played[] = [
    // Set 1 25-23: a timeout each side, France's at 8 rallies played, ROC's at 20.
    {
      home: 25,
      away: 23,
      placed: [
        { after: 8, timeout: 'first' },
        { after: 20, timeout: 'second' },
      ],
    },
    // Set 2 25-17: France's first sub.
    { home: 25, away: 17, placed: [{ after: 10, sub: 'first', off: 2, on: 7 }] },
    // Set 3 21-25 to ROC: a warning to France, a penalty against France whose rally is ROC's next point, two subs.
    {
      home: 21,
      away: 25,
      placed: [
        { after: 12, warning: 'first', person: 3 },
        { after: 20, sub: 'second', off: 1, on: 7 },
        { after: 30, penalty: 'first', person: 4 },
        { after: 36, sub: 'second', off: 5, on: 1 },
      ],
    },
    { home: 21, away: 25 },
    // Set 5 15-12: the deciding set, tossed afresh: ROC pick the serve.
    { home: 15, away: 12 },
  ];
  it(
    'every set ends at its published score and the server holds the match as played, with nothing refused or left unsent',
    async () => {
      const seed = named(indoorSeed({ fixtureId: 'replay-indoor' }), 'France', 'ROC');
      const scorer = await opened(seed);
      await start(scorer, 'first');
      for (const set of SETS.slice(0, 4)) await scorer.play(set);
      await scorer.play(SETS[4]!, 'second');
      await wait(5_000);
      const ledger = await scorer.ledger();
      const { view } = scorer.pad;

      // The match as published: each side's score in each set, the sets it won marked.
      const boxes = (side: 0 | 1) => view.halves[side].periods?.scores ?? [];
      expect(boxes(0).map((box) => box.value)).toEqual(['25', '25', '21', '21', '15']);
      expect(boxes(1).map((box) => box.value)).toEqual(['23', '17', '25', '25', '12']);
      expect(boxes(0).map((box) => box.won)).toEqual([true, true, false, false, true]);
      expect(view.card?.kind).toBe('resultRecorded');
      expect(view.tally?.shown).toBe('3:2');
      expect(scorer.counts.refusals).toBe(0);
      const queue = scorer.fakes.queueFiles.files.get('replay-indoor.json');
      expect(queue === undefined ? 0 : (JSON.parse(queue).pending as unknown[]).length).toBe(0);

      // What the server holds: 48 + 42 + 46 + 46 + 27 rallies, and what was placed.
      expect(typesIn(ledger, 'volleyball.rally')).toHaveLength(209);
      expect(
        typesIn(ledger, 'volleyball.timeout').map((e) => (e.payload as { by: string }).by),
      ).toEqual([HOME_ENTRANT, AWAY_ENTRANT]);
      expect(typesIn(ledger, 'volleyball.sub').map((e) => e.payload)).toEqual([
        { by: HOME_ENTRANT, off: `${HOME_ENTRANT}-p2`, on: `${HOME_ENTRANT}-p7` },
        { by: AWAY_ENTRANT, off: `${AWAY_ENTRANT}-p1`, on: `${AWAY_ENTRANT}-p7` },
        { by: AWAY_ENTRANT, off: `${AWAY_ENTRANT}-p5`, on: `${AWAY_ENTRANT}-p1` },
      ]);
      expect(typesIn(ledger, 'volleyball.sanction').map((e) => e.payload)).toEqual([
        { by: HOME_ENTRANT, level: 'warning', person: `${HOME_ENTRANT}-p3` },
        { by: HOME_ENTRANT, level: 'penalty', person: `${HOME_ENTRANT}-p4` },
      ]);

      // Indoor sends no `server`; `serving` rides the match's first rally (Start's pick) and the deciding set's first (the
      // toss, ruling 180) and no other: the 183rd rally is the first of set 5 (48 + 42 + 46 + 46 = 182 before it).
      const rallies = typesIn(ledger, 'volleyball.rally').map(
        (e) => e.payload as { serving?: string; server?: string },
      );
      expect(rallies.flatMap((r, i) => (r.serving === undefined ? [] : [i]))).toEqual([0, 182]);
      expect(rallies[0]?.serving).toBe(HOME_ENTRANT);
      expect(rallies[182]?.serving).toBe(AWAY_ENTRANT);
      expect(rallies.every((r) => r.server === undefined)).toBe(true);

      // History, newest set first, names the penalty, the warning and the toss.
      act(() => scorer.pad.actions.history());
      const sheet = scorer.pad.sheet;
      if (sheet?.kind !== 'history') throw new Error(`expected History, got ${sheet?.kind}`);
      const groups = sheet.groups as readonly {
        heading: { vars?: { set?: unknown } };
        rows: readonly { said: { key: string } }[];
      }[];
      expect(groups.map((group) => group.heading.vars?.set)).toEqual([5, 4, 3, 2, 1]);
      const keys = (n: number) => groups[5 - n]!.rows.map((row) => row.said.key);
      expect(keys(3).filter((key) => key === 'scoring.volleyball.last.sanction')).toHaveLength(2);
      expect(keys(5)).toContain('scoring.volleyball.last.toss');
    },
    REPLAY_TIMEOUT,
  );
});

describe('the Tokyo 2020 men’s final, beach: Norway 2-0 ROC', () => {
  const NORWAY = ['A. Mol', 'C. Sorum'] as const;

  it(
    'both sets end at 21-17 and 21-18, and every rally after the first names a server of the side that won the one before',
    async () => {
      const base = beachSeed({ fixtureId: 'replay-beach' });
      const seed: FakeMatchSeed = {
        ...base,
        sides: {
          home: {
            ...base.sides.home,
            name: NORWAY.join(' / '),
            members: base.sides.home.members.map((m, i) => ({
              ...m,
              fullName: NORWAY[i] ?? m.fullName,
            })),
          },
          away: base.sides.away,
        },
      };
      const scorer = await opened(seed);
      await start(scorer, 'first');
      const sets: readonly Played[] = [
        { home: 21, away: 17, placed: [{ after: 10, timeout: 'second' }] },
        { home: 21, away: 18 },
      ];
      for (const set of sets) await scorer.play(set);
      await wait(5_000);
      const { view } = scorer.pad;
      const boxes = (side: 0 | 1) => view.halves[side].periods?.scores.map((box) => box.value);
      expect(boxes(0)).toEqual(['21', '21']);
      expect(boxes(1)).toEqual(['17', '18']);
      expect(view.tally?.shown).toBe('2:0');
      expect(scorer.counts.refusals).toBe(0);
      const ledger = await scorer.ledger();
      const rallies = typesIn(ledger, 'volleyball.rally').map(
        (e) => e.payload as { wonBy: string; serving?: string; server?: string },
      );
      expect(rallies).toHaveLength(38 + 39);
      expect(rallies[0]).toMatchObject({ serving: HOME_ENTRANT });
      expect(rallies[0]?.server).toBeUndefined();
      // The server is a player of the side that served: the side that won the rally before (the first set's opener aside,
      // set 2's first server is the side that did not serve set 1's first: the engine's alternation, so only the person's
      // side is asserted there).
      rallies.slice(1).forEach((rally, i) => {
        expect(rally.server, `rally ${i + 2}`).toMatch(/^ent-(home|away)-p[12]$/);
        expect(rally.serving).toBeUndefined();
        const servingEntrant = rallies[i]!.wonBy;
        if (i + 1 !== 38)
          expect(rally.server!.startsWith(servingEntrant), `rally ${i + 2}`).toBe(true);
      });
    },
    REPLAY_TIMEOUT,
  );
});
