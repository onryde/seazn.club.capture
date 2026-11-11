import { act, renderHook } from '@testing-library/react';
import { foldMatch, type GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import { football, type FootballState } from '@seazn/engine/sports/football';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footballBoard, footballMoreItems } from '@/domain/scoring/footballBoard';
import { matchTime, minuteText, subStampFor } from '@/domain/scoring/footballClock';
import { footballCfg, footballRefusalOf } from '@/domain/scoring/footballEngine';
import { footballResultLine } from '@/domain/scoring/footballPad';
import type { FootballDisplay } from '@/domain/scoring/footballTypes';
import type { PadSide } from '@/domain/scoring/padView';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { LedgerEvent } from '@/domain/scoring/wire';
import {
  ARG,
  arg,
  FRA,
  fra,
  GOALS,
  KICKS,
  PERIOD_ENDS,
  SUBS,
  wc2022Seed,
  YELLOWS,
  type Minute,
} from '@/hooks/footballReplay.wc2022';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The 2022 World Cup final replayed through the phone's scoring path (owner, 2026-11-11: "a real match with lots of
// activity"). The seam is the hook, `useFootballMatch`, over the real runner, hub, queue store, sync, stamping, the engine
// fold and a fake server that judges every append with the engine alone: what a phone runs from a tap to History. The
// scorer taps every event at its real minute on a clock that runs and is never paused, through the sheets a scorer sees.
//
// The expected values are the real match's (`footballReplay.wc2022.ts`), never computed by the code under test (AGENTS
// §10). Where the phone differs from the match, the test asserts the match and is marked `it.fails` with a finding ID
// (F-R1 …); the full findings are in the replay report (`.superpowers/sdd/2026-11-08-s2-5-p-phone/replay-wc2022-report.md`
// in the s2-5 worktree). The match is replayed ONCE (`replayed()`), as plain observations, and every test reads them.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
/** Kick-off, 2022-12-18 16:00 Doha time. */
const KICK_OFF_MS = Date.parse('2022-12-18T15:00:00.000Z');
const SEED = wc2022Seed();
const REPLAY_TIMEOUT = 180_000;

// ---------------------------------------------------------------------------------------------------------------
// The real minute as the phone's clock reads it
// ---------------------------------------------------------------------------------------------------------------

type Period = 'H1' | 'H2' | 'ET_H1' | 'ET_H2';

/** Where each period starts on the match's count, in minutes, and its nominal length. */
const PERIOD_START: Readonly<Record<Period, number>> = { H1: 0, H2: 45, ET_H1: 90, ET_H2: 105 };
const PERIOD_MINUTES: Readonly<Record<Period, number>> = { H1: 45, H2: 45, ET_H1: 15, ET_H2: 15 };

function periodOf(at: Minute): Period {
  if (at.minute <= 45) return 'H1';
  if (at.minute <= 90) return 'H2';
  return at.minute <= 105 ? 'ET_H1' : 'ET_H2';
}

/**
 * The seconds into its period that a scoresheet minute is played at, `second` seconds into that minute: "23'" is 22:00
 * to 22:59 of the first half, "45+7'" is 6:00 to 6:59 past its 45:00, "96'" is 5:00 to 5:59 into extra time.
 */
function elapsedAt(at: Minute, second = 30): number {
  const period = periodOf(at);
  if (at.added !== undefined) return (PERIOD_MINUTES[period] + at.added - 1) * 60 + second;
  return (at.minute - PERIOD_START[period] - 1) * 60 + second;
}

/** A scoresheet minute as History writes it: "23'", "45+7'". */
const said = (at: Minute): string =>
  at.added === undefined ? `${at.minute}'` : `${at.minute}+${at.added}'`;

// ---------------------------------------------------------------------------------------------------------------
// The match on the phone
// ---------------------------------------------------------------------------------------------------------------

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useFootballMatch>, unknown>>;
type Pad = Extract<ReturnType<typeof useFootballMatch>, { kind: 'pad' }>;

function padOf(view: Hook): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

/** The engine's match, built from the bootstrap as the phone builds it, to ask the engine what it would refuse. */
const ENGINE_MATCH = {
  fixtureId: SEED.fixtureId,
  cfg: footballCfg(SEED.cfg)!,
  lineups: { home: teamSheetOf(SEED.sides.home).lineup, away: teamSheetOf(SEED.sides.away).lineup },
};

const ENTRANT: Readonly<Record<PadSide, string>> = { first: ARG, second: FRA };
const personOf = (side: PadSide, number: number) => (side === 'first' ? arg(number) : fra(number));

/** What the scorer saw and what the server holds, after one real event was tapped (or could not be). */
type Observed = {
  readonly label: string;
  /** The clock's reading when the scorer pressed the event's button, and the reading the real minute is at. */
  readonly reading: number;
  readonly expectedReading: number;
  /** The board offered the event's button (Sub can be off: "No subs left"). */
  readonly offered: boolean;
  /** Each step's choices, as ids (`p.arg-10`), in order. */
  readonly steps: readonly (readonly string[])[];
  /** The player the scorer meant was not among a step's choices. */
  readonly missing: string | null;
  /** The ledger holds a new event of the type tapped: its payload. */
  readonly recorded: Readonly<Record<string, unknown>> | null;
  /** The engine's refusal code for the event as the phone would stamp it, when the phone did not record it. */
  readonly refusal: string | null;
  readonly halves: readonly [string, string];
  readonly display: FootballDisplay;
};

type Replay = {
  readonly observed: readonly Observed[];
  readonly ledger: readonly LedgerEvent[];
  readonly history: readonly { heading: string; key: string; vars: Record<string, unknown> }[];
  /** The Yellow sheets after the last yellow (116'): each choice id and its note's key. */
  readonly yellowNotes: Readonly<
    Record<PadSide, readonly { id: string; note: string | null; kind: string }[]>
  >;
  /** In the shootout: the buttons each column offers, and the More sheet's items. */
  readonly shootoutButtons: Readonly<Record<PadSide, readonly string[]>>;
  readonly shootoutMore: readonly string[];
  /** After the eighth kick. */
  readonly end: {
    readonly display: FootballDisplay;
    readonly halves: readonly [string, string];
    readonly tally: string;
    readonly kickButtons: readonly { id: string; enabled: boolean }[];
  };
  readonly records: readonly string[];
};

/** One phone at the ground: its fakes, the hook, and when the current period's clock was started on it. */
class Scorer {
  periodStartMs = 0;
  constructor(
    readonly fakes: FakePorts,
    readonly view: Hook,
  ) {}

  get pad(): Pad {
    return padOf(this.view);
  }

  press(make: (actions: Pad['actions']) => void): void {
    act(() => make(this.pad.actions));
  }

  async ledger(): Promise<readonly LedgerEvent[]> {
    const events = await this.fakes.scoring.events(LINK, SEED.fixtureId, 0);
    return Array.isArray(events) ? events : [];
  }

  /** The clock runs on: wait until the period's clock reads `elapsed` and half a second. */
  async to(elapsed: number): Promise<void> {
    const target = this.periodStartMs + elapsed * 1000 + 500;
    const ms = target - Date.now();
    if (ms < 0) throw new Error(`the replay went back in time (${ms} ms)`);
    await wait(ms);
  }

  /** Start (or resume) the clock: the period's 0:00 is now. */
  async startClock(): Promise<void> {
    await wait(2_000);
    this.periodStartMs = Date.now();
    this.press((actions) => actions.clock());
    await flush();
    await wait(2_000);
  }

  async endPeriod(): Promise<void> {
    await wait(2_000);
    this.press((actions) => actions.tool('period'));
    await flush();
    await wait(2_000);
  }

  /** A column's button; then each step's choice, or the fallback when the meant player is not offered. */
  async tapThrough(
    button: string,
    choices: readonly { readonly id: string; readonly orElse?: string }[],
  ): Promise<{ steps: string[][]; missing: string | null }> {
    const steps: string[][] = [];
    let missing: string | null = null;
    this.press((actions) => actions.column(button));
    await wait(300);
    for (const choice of choices) {
      const { sheet } = this.pad;
      if (sheet?.kind !== 'step') break;
      const ids = sheet.sheet.options.map((option) => option.id);
      steps.push(ids);
      let id = choice.id;
      // A disabled row (Normal sub with no ordinary sub left) cannot be chosen: it is as good as not offered.
      const live = sheet.sheet.options
        .filter((option) => option.disabled !== true)
        .map((o) => o.id);
      if (!live.includes(id)) {
        missing ??= id;
        if (choice.orElse === undefined) {
          this.press((actions) => actions.cancelSheet());
          await flush();
          break;
        }
        id = choice.orElse;
      }
      await wait(300);
      this.press((actions) => actions.choose(id));
      await flush();
    }
    await wait(1_000);
    await flush();
    return { steps, missing };
  }

  buttonOf(side: PadSide, word: string): { enabled: boolean } | undefined {
    const board = footballBoard(this.pad.display, this.pad.view.card);
    const column = board.columns[side === 'first' ? 0 : 1];
    return column.actions.find((action) => action.id === `${word}.${side}`);
  }
}

async function opened(): Promise<Scorer> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: SEED });
  await saveScoringLink(fakes.kv, SEED.fixtureId, LINK, HOST, 'football');
  const view = renderHook(() => useFootballMatch(SEED.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait();
  return new Scorer(fakes, view);
}

type TimelineItem =
  | { readonly kind: 'goal'; readonly goal: (typeof GOALS)[number]; readonly second?: number }
  | { readonly kind: 'yellow'; readonly card: (typeof YELLOWS)[number]; readonly second?: number }
  | { readonly kind: 'sub'; readonly sub: (typeof SUBS)[number]; readonly second?: number }
  | { readonly kind: 'end'; readonly at: Minute; readonly second: number }
  | { readonly kind: 'start' };

const goal = (i: number, second?: number): TimelineItem => ({
  kind: 'goal',
  goal: GOALS[i]!,
  ...(second === undefined ? {} : { second }),
});
const yellow = (i: number, second?: number): TimelineItem => ({
  kind: 'yellow',
  card: YELLOWS[i]!,
  ...(second === undefined ? {} : { second }),
});
const sub = (i: number, second?: number): TimelineItem => ({
  kind: 'sub',
  sub: SUBS[i]!,
  ...(second === undefined ? {} : { second }),
});

/**
 * The match in the order it was played. Two subs at one stoppage are tapped 15 s apart, as a scorer picking two players
 * would; where two events share a minute, the one first in the real match is tapped first.
 */
const TIMELINE: readonly TimelineItem[] = [
  { kind: 'start' },
  goal(0),
  goal(1),
  sub(0, 30),
  sub(1, 45),
  yellow(0, 10),
  { kind: 'end', at: PERIOD_ENDS.H1, second: 40 },
  { kind: 'start' },
  yellow(1),
  sub(2),
  sub(3, 30),
  sub(4, 45),
  goal(2),
  goal(3),
  yellow(2),
  yellow(3),
  yellow(4, 10),
  { kind: 'end', at: PERIOD_ENDS.H2, second: 40 },
  // Molina → Montiel, in the break before extra time: no reading, so no stamp and no window (Law 3).
  sub(5),
  { kind: 'start' },
  sub(6),
  sub(7, 30),
  sub(8, 45),
  { kind: 'end', at: PERIOD_ENDS.ET_H1, second: 50 },
  { kind: 'start' },
  goal(4),
  sub(9),
  yellow(5),
  yellow(6, 10),
  sub(10, 40),
  goal(5),
  sub(11, 10),
  sub(12, 25),
  { kind: 'end', at: PERIOD_ENDS.ET_H2, second: 45 },
];

/** The breaks between periods, as long as they were (about): half-time 15 min, before extra time 5, at its half 1. */
const BREAKS_MS = [15 * 60_000, 5 * 60_000, 60_000];

async function observe(
  scorer: Scorer,
  label: string,
  expectedReading: number,
  reading: number,
  type: string,
  tapped: { offered: boolean; steps: readonly (readonly string[])[]; missing: string | null },
  before: number,
  refusal: string | null,
): Promise<Observed> {
  const ledger = await scorer.ledger();
  const fresh = ledger.slice(before).filter((event) => event.type === type);
  const { pad } = scorer;
  return {
    label,
    reading,
    expectedReading,
    ...tapped,
    recorded: (fresh.at(-1)?.payload as Record<string, unknown> | undefined) ?? null,
    refusal,
    halves: [pad.view.halves[0].value, pad.view.halves[1].value],
    display: pad.display,
  };
}

/**
 * The engine's word on a sub the phone did not record, stamped as the phone stamps one (`subStampFor`, ruling 154): the
 * reading when Sub would have been pressed, joining the stoppage within 120 s of it.
 */
async function refusalOfSub(
  scorer: Scorer,
  side: PadSide,
  off: string,
  on: string,
  reading: number,
): Promise<string | null> {
  const ledger = await scorer.ledger();
  const envelopes = ledger.map((event) => envelopeOf(SEED.fixtureId, event));
  const { clock, enginePhase } = scorer.pad.display;
  const captured = clock.anchor === null ? null : { period: clock.anchor.period, elapsed: reading };
  const at: GameTime | null = subStampFor(captured, enginePhase, clock.asOf, clock.stoppage);
  const candidate = {
    ...envelopes.at(-1)!,
    id: 'replay-candidate',
    seq: envelopes.length + 1,
    type: 'football.sub',
    payload: { by: ENTRANT[side], off, on, ...(at === null ? {} : { at }) },
  };
  return footballRefusalOf(ENGINE_MATCH, [...envelopes, candidate])?.code ?? null;
}

async function play(
  scorer: Scorer,
  item: TimelineItem,
  breaks: number[],
): Promise<Observed | null> {
  if (item.kind === 'start') {
    if (scorer.periodStartMs !== 0) await wait(breaks.shift() ?? 0);
    await scorer.startClock();
    return null;
  }
  if (item.kind === 'end') {
    await scorer.to(elapsedAt(item.at, item.second));
    await scorer.endPeriod();
    return null;
  }
  const at =
    item.kind === 'goal' ? item.goal.at : item.kind === 'yellow' ? item.card.at : item.sub.at;
  const inBreak = item.kind === 'sub' && 'inBreak' in item.sub;
  // In a break the clock has no reading: it reads 0 and a tap carries no stamp.
  const expectedReading = inBreak ? 0 : elapsedAt(at, item.second);
  if (!inBreak) await scorer.to(expectedReading);
  const reading = scorer.pad.readingNow();
  const before = (await scorer.ledger()).length;
  if (item.kind === 'goal') {
    const { side, scorer: number, penalty } = item.goal;
    const choices = [
      ...(penalty ? [{ id: 'penalty' }] : []),
      { id: `p.${personOf(side, number)}` },
      ...(penalty ? [] : [{ id: 'noAssist' }]),
    ];
    const tapped = await scorer.tapThrough(`goal.${side}`, choices);
    const label = `goal ${said(at)} #${number}`;
    return observe(
      scorer,
      label,
      expectedReading,
      reading,
      'football.goal',
      { offered: true, ...tapped },
      before,
      null,
    );
  }
  if (item.kind === 'yellow') {
    const { side, person } = item.card;
    const tapped = await scorer.tapThrough(`yellow.${side}`, [
      { id: `p.${personOf(side, person)}` },
      { id: 'noReason' },
    ]);
    const label = `yellow ${said(at)} #${person}`;
    return observe(
      scorer,
      label,
      expectedReading,
      reading,
      'football.card',
      { offered: true, ...tapped },
      before,
      null,
    );
  }
  const { side, off, on } = item.sub;
  const concussion = 'concussion' in item.sub;
  const label = `sub ${said(at)} #${off}→#${on}`;
  const offered = scorer.buttonOf(side, 'sub')?.enabled === true;
  const tapped = offered
    ? await scorer.tapThrough(`sub.${side}`, [
        { id: `p.${personOf(side, off)}` },
        { id: `p.${personOf(side, on)}` },
        // The final runs the IFAB concussion trial (`concussionSubs`): the sheet asks which kind (ruling 155).
        { id: concussion ? 'concussionSub' : 'normalSub' },
      ])
    : { steps: [], missing: null };
  const observed = await observe(
    scorer,
    label,
    expectedReading,
    reading,
    concussion ? 'core.lineup.replacement' : 'football.sub',
    { offered, ...tapped },
    before,
    null,
  );
  if (observed.recorded !== null) return observed;
  const refusal = await refusalOfSub(
    scorer,
    side,
    personOf(side, off),
    personOf(side, on),
    reading,
  );
  return { ...observed, refusal };
}

/** Each team's Yellow sheet: its choices, and which carry a note. The sheet is cancelled, so nothing is recorded. */
async function yellowSheet(scorer: Scorer, side: PadSide) {
  scorer.press((actions) => actions.column(`yellow.${side}`));
  await wait(300);
  const { sheet } = scorer.pad;
  const options =
    sheet?.kind === 'step'
      ? sheet.sheet.options.map((option) => ({
          id: option.id,
          note: option.note?.key ?? null,
          kind: option.kind ?? 'choice',
        }))
      : [];
  await wait(300);
  scorer.press((actions) => actions.cancelSheet());
  await flush();
  await wait(1_000);
  return options;
}

async function shootout(scorer: Scorer) {
  const buttons = (side: PadSide) =>
    footballBoard(scorer.pad.display, scorer.pad.view.card)
      .columns[side === 'first' ? 0 : 1].actions.filter((action) => action.enabled)
      .map((action) => action.id);
  const shootoutButtons = { first: buttons('first'), second: buttons('second') };
  const shootoutMore = footballMoreItems(scorer.pad.display).map((item) => item.id);
  const kicks: Observed[] = [];
  for (const kick of KICKS) {
    await wait(20_000);
    const before = (await scorer.ledger()).length;
    const word = kick.scored ? 'scored' : 'missed';
    const tapped = await scorer.tapThrough(`${word}.${kick.side}`, [
      { id: `p.${personOf(kick.side, kick.taker)}`, orElse: 'dontKnow' },
    ]);
    const label = `kick ${kick.side} #${kick.taker} ${word}`;
    kicks.push(
      await observe(
        scorer,
        label,
        0,
        0,
        'football.shootout.kick',
        { offered: true, ...tapped },
        before,
        null,
      ),
    );
  }
  return { shootoutButtons, shootoutMore, kicks };
}

function historyOf(scorer: Scorer): Replay['history'] {
  scorer.press((actions) => actions.history());
  const { sheet } = scorer.pad;
  if (sheet?.kind !== 'history') throw new Error('History did not open');
  const rows = [...sheet.groups].reverse().flatMap((group) =>
    [...group.rows].reverse().map((row) => ({
      heading: group.heading.key,
      key: row.said.key,
      vars: (row.said.vars ?? {}) as Record<string, unknown>,
    })),
  );
  scorer.press((actions) => actions.cancelSheet());
  return rows;
}

async function replay(): Promise<{ replay: Replay; kicks: readonly Observed[] }> {
  vi.setSystemTime(new Date(KICK_OFF_MS - 60_000));
  const scorer = await opened();
  scorer.press((actions) => actions.start());
  await flush();
  const observed: Observed[] = [];
  const breaks = [...BREAKS_MS];
  let yellowNotes: Replay['yellowNotes'] = { first: [], second: [] };
  for (const item of TIMELINE) {
    const seen = await play(scorer, item, breaks);
    if (seen !== null) observed.push(seen);
    if (item.kind === 'sub' && item.sub === SUBS[10]) {
      yellowNotes = {
        first: await yellowSheet(scorer, 'first'),
        second: await yellowSheet(scorer, 'second'),
      };
    }
  }
  await wait(60_000);
  const { shootoutButtons, shootoutMore, kicks } = await shootout(scorer);
  await wait(5_000);
  const { pad } = scorer;
  const end = {
    display: pad.display,
    halves: [pad.view.halves[0].value, pad.view.halves[1].value] as const,
    tally: pad.view.tally.shown,
    kickButtons: footballBoard(pad.display, pad.view.card).columns.flatMap((column) =>
      column.actions.map((action) => ({ id: action.id, enabled: action.enabled })),
    ),
  };
  const history = historyOf(scorer);
  const ledger = await scorer.ledger();
  const records = readRecord(scorer.fakes.record).map((line) => line.event);
  scorer.view.unmount();
  return {
    replay: { observed, ledger, history, yellowNotes, shootoutButtons, shootoutMore, end, records },
    kicks,
  };
}

let memo: Promise<Awaited<ReturnType<typeof replay>>> | null = null;
/** The match, replayed once per file run; every test reads what it saw. */
const replayed = () => (memo ??= replay());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------------------------
// Reading what the replay saw
// ---------------------------------------------------------------------------------------------------------------

const observedOf = async (label: string): Promise<Observed> => {
  const found = (await replayed()).replay.observed.find((seen) => seen.label === label);
  if (found === undefined) throw new Error(`the replay saw no "${label}"`);
  return found;
};

const subLabel = (s: (typeof SUBS)[number]) => `sub ${said(s.at)} #${s.off}→#${s.on}`;

/** The engine's own fold of what the server holds: its windows per side, and its outcome. */
async function engineState() {
  const { ledger } = (await replayed()).replay;
  const envelopes = ledger.map((event) => envelopeOf(SEED.fixtureId, event));
  return foldMatch(football, ENGINE_MATCH.cfg, ENGINE_MATCH.lineups, envelopes) as FootballState;
}

/** A stamp as the scoresheet minute History would write for it. */
const minuteOf = (at: GameTime) => minuteText(matchTime(at, ENGINE_MATCH.cfg));

/** History's rows of one kind, as `[minute, the rest]`. */
async function historyRows(key: string) {
  const { history } = (await replayed()).replay;
  return history.filter((row) => row.key === `scoring.football.last.${key}`);
}

describe('the 2022 World Cup final, replayed through the phone', () => {
  describe('the clock and the score', () => {
    it(
      'the clock reads the real minute at every tap, through added time and extra time',
      async () => {
        const { observed } = (await replayed()).replay;
        expect(observed).toHaveLength(GOALS.length + YELLOWS.length + SUBS.length);
        for (const seen of observed)
          expect([seen.label, seen.reading]).toEqual([seen.label, seen.expectedReading]);
      },
      REPLAY_TIMEOUT,
    );

    it('the running score after each goal: 1–0, 2–0, 2–1, 2–2, 3–2, 3–3', async () => {
      const after = await Promise.all(
        GOALS.map((g) => observedOf(`goal ${said(g.at)} #${g.scorer}`)),
      );
      expect(after.map((seen) => seen.halves)).toEqual([
        ['1', '0'],
        ['2', '0'],
        ['2', '1'],
        ['2', '2'],
        ['3', '2'],
        ['3', '3'],
      ]);
    });

    it('3–3 after extra time, 4–2 on penalties: the result line, the card and the engine name Argentina', async () => {
      const { end } = (await replayed()).replay;
      expect(end.display.goals).toEqual({ first: 3, second: 3 });
      expect(end.halves).toEqual(['3 (4)', '3 (2)']);
      expect(footballResultLine(end.display)).toBe('3–3 (4–2)');
      expect(end.display.phase).toBe('decided');
      const { outcome } = await engineState();
      expect(outcome).toMatchObject({ winner: ARG });
    });
  });

  describe('minutes in History', () => {
    it('every goal and card reads its real minute', async () => {
      const goals = [...(await historyRows('penaltyGoal')), ...(await historyRows('goal'))];
      expect(goals.map((row) => row.vars.at).sort()).toEqual(
        GOALS.map((g) => ` ${said(g.at)}`).sort(),
      );
      const cards = await historyRows('card');
      expect(cards.map((row) => [row.vars.who, row.vars.at])).toEqual(
        YELLOWS.map((card) => [expect.stringContaining(`#${card.person} `), ` ${said(card.at)}`]),
      );
    });

    it('each period ends at its real minute: 45+7, 90+8, 105, 120+1', async () => {
      const ends = await historyRows('period');
      expect(ends.map((row) => row.vars.at)).toEqual([" 45+7'", " 90+8'", " 105'", " 120+1'"]);
    });

    it('F-R1: every substitution the phone recorded reads its real minute (41, 64, 71, 96, 102), and the break’s none', async () => {
      const rows = await historyRows('sub');
      const recorded = SUBS.filter((s) =>
        rows.some((row) => row.vars.off === `#${s.off}` && row.vars.on === `#${s.on}`),
      );
      expect(recorded.length).toBeGreaterThanOrEqual(9);
      expect(rows.map((row) => [row.vars.off, row.vars.on, row.vars.at])).toEqual(
        recorded.map((s) => [`#${s.off}`, `#${s.on}`, 'inBreak' in s ? '' : ` ${said(s.at)}`]),
      );
    });
  });

  describe('substitutions', () => {
    it('the subs up to 102 are all recorded, each with the players the scorer chose; Rabiot → Fofana as a concussion replacement', async () => {
      for (const s of SUBS.slice(0, 9)) {
        const seen = await observedOf(subLabel(s));
        const off = personOf(s.side, s.off);
        const on = personOf(s.side, s.on);
        expect([seen.label, seen.recorded]).toMatchObject([
          seen.label,
          'concussion' in s
            ? { side: ENTRANT[s.side], off, on: { personId: on }, exemption: 'concussion' }
            : { by: ENTRANT[s.side], off, on },
        ]);
      }
    });

    it('who came off is never offered on again (no rolling subs), and who came on is offered off', async () => {
      const done: (typeof SUBS)[number][] = [];
      for (const s of SUBS) {
        const seen = await observedOf(subLabel(s));
        const [offList, onList] = seen.steps;
        for (const earlier of done.filter((d) => d.side === s.side)) {
          if (offList !== undefined) {
            expect(offList).toContain(`p.${personOf(s.side, earlier.on)}`);
            expect(offList).not.toContain(`p.${personOf(s.side, earlier.off)}`);
          }
          if (onList !== undefined)
            expect(onList).not.toContain(`p.${personOf(s.side, earlier.off)}`);
        }
        if (seen.recorded === null) continue;
        const team = seen.display.sides[s.side];
        expect(team.onPitch.map((p) => p.personId)).toContain(personOf(s.side, s.on));
        expect(team.onPitch.map((p) => p.personId)).not.toContain(personOf(s.side, s.off));
        expect(team.offeredOn.map((p) => p.personId)).not.toContain(personOf(s.side, s.off));
        done.push(s);
      }
      expect(done.length).toBeGreaterThan(0);
    });

    it.fails(
      'F-R2, F-R3: neither side is ever told "No subs left": both made every real substitution',
      async () => {
        const { observed } = (await replayed()).replay;
        expect(observed.map((seen) => [seen.label, seen.display.subsLeft])).toEqual(
          observed.map((seen) => [seen.label, { first: true, second: true }]),
        );
      },
    );

    it('F-R2: after the concussion substitution at 96, France may still substitute', async () => {
      const seen = await observedOf(subLabel(SUBS[6]));
      expect(seen.recorded).not.toBeNull();
      expect(seen.display.subsLeft.second).toBe(true);
    });

    it('F-R2: 113 Varane → Konaté (France’s 5th ordinary sub) is recorded', async () => {
      const seen = await observedOf(subLabel(SUBS[9]));
      expect([seen.offered, seen.refusal, seen.recorded]).toEqual([
        true,
        null,
        expect.objectContaining({ off: fra(4), on: fra(24) }),
      ]);
    });

    // With Molina → Montiel in the break (no window), 116 is Argentina's third window and fifth sub: legal at 5/3.
    it('116 Mac Allister → Pezzella (Argentina’s 3rd window, 5th sub) is recorded', async () => {
      const seen = await observedOf(subLabel(SUBS[10]));
      expect([seen.offered, seen.refusal, seen.recorded]).toEqual([
        true,
        null,
        expect.objectContaining({ off: arg(20), on: arg(6) }),
      ]);
    });

    it.fails(
      'F-R3: 120+1 Koundé → Disasi (France’s 6th ordinary sub, the extra-time sub) is recorded',
      async () => {
        const seen = await observedOf(subLabel(SUBS[11]));
        expect([seen.offered, seen.refusal, seen.recorded]).toEqual([
          true,
          null,
          expect.objectContaining({ off: fra(5), on: fra(3) }),
        ]);
      },
    );

    it.fails('F-R3: 120+1 Tagliafico → Dybala (Argentina’s 6th sub) is recorded', async () => {
      const seen = await observedOf(subLabel(SUBS[12]));
      expect([seen.offered, seen.refusal, seen.recorded]).toEqual([
        true,
        null,
        expect.objectContaining({ off: arg(3), on: arg(21) }),
      ]);
    });

    it('the engine refuses the two it would not take, by these codes (pinned so a change is seen)', async () => {
      const refused = await Promise.all([SUBS[11], SUBS[12]].map((s) => observedOf(subLabel(s))));
      // Observed codes, pinned as evidence for F-R2 and F-R3; reality is the it.fails tests above. The board offered none of
      // them as an ordinary sub: Sub read "No subs left" before each was due. Each is a sixth ordinary sub (the kernel's cap
      // first); the concussion replacement is outside the cap (F-R2), so Konaté at 113 is recorded.
      expect(refused.map((seen) => [seen.label, seen.offered, seen.refusal])).toEqual([
        [subLabel(SUBS[11]), false, 'INVALID_EVENT'],
        // Argentina still holds its concussion exemption, so Sub opens; Normal sub is disabled (No subs left).
        [subLabel(SUBS[12]), true, 'INVALID_EVENT'],
      ]);
    });

    it('up to 102 the engine counts the windows the match used: France 2 in normal time, Argentina 2 (64, 102)', async () => {
      const state = await engineState();
      const fraNormal = (state.squads.away.subWindows ?? []).filter((w) =>
        w.period.startsWith('H'),
      );
      expect(fraNormal).toHaveLength(2);
      const argTo102 = (state.squads.home.subWindows ?? []).filter((w) => w.period !== 'ET_H2');
      expect(argTo102.map(minuteOf)).toEqual(["64'", "102'"]);
    });

    it('F-R2: the concussion substitution opens no window: France used 2 windows (41, 71) before 113', async () => {
      const state = await engineState();
      const before113 = (state.squads.away.subWindows ?? []).filter((w) => w.period !== 'ET_H2');
      expect(before113.map(minuteOf)).toEqual(["41'", "71'"]);
    });

    // Molina → Montiel at the break opens no window; Argentina's 120+1 (its 4th window, the extra-time one) is F-R3's.
    it('F-R1: each window sits at the minute it was used (France 41, 71; Argentina 64, 102, 116)', async () => {
      const state = await engineState();
      const minutes = (windows: readonly GameTime[] | undefined) => (windows ?? []).map(minuteOf);
      expect({
        france: minutes(state.squads.away.subWindows).slice(0, 2),
        argentina: minutes(state.squads.home.subWindows),
      }).toEqual({ france: ["41'", "71'"], argentina: ["64'", "102'", "116'"] });
    });

    it('Molina → Montiel, in the break before extra time, is recorded unstamped', async () => {
      const seen = await observedOf(subLabel(SUBS[5]));
      expect(seen.recorded).toEqual({ by: ARG, off: arg(26), on: arg(4) });
    });
  });

  describe('cards', () => {
    it('Giroud, subbed off at 41, is in the Yellow list under Bench at 90+5, and his booking is recorded', async () => {
      const seen = await observedOf(`yellow 90+5' #9`);
      const [players] = seen.steps;
      expect(players!.indexOf(`p.${fra(9)}`)).toBeGreaterThan(players!.indexOf('heading.bench'));
      expect(seen.recorded).toMatchObject({ by: FRA, person: fra(9), color: 'yellow' });
    });

    it('each booked player carries "2nd yellow · sent off" on a second Yellow, and nobody else does', async () => {
      const { yellowNotes } = (await replayed()).replay;
      const noted = (side: PadSide) =>
        yellowNotes[side]
          .filter((option) => option.note === 'scoring.football.sheet.secondYellow')
          .map((option) => option.id)
          .sort();
      expect(noted('first')).toEqual(
        [`p.${arg(24)}`, `p.${arg(8)}`, `p.${arg(5)}`, `p.${arg(4)}`].sort(),
      );
      expect(noted('second')).toEqual([`p.${fra(14)}`, `p.${fra(26)}`, `p.${fra(9)}`].sort());
    });

    it('nobody is sent off', async () => {
      const { end } = (await replayed()).replay;
      for (const side of ['first', 'second'] as const) {
        expect(end.display.sides[side].sentOff).toEqual([]);
        expect(end.display.sides[side].cards.red).toBe(0);
      }
      expect(end.display.sides.first.cards.yellow).toBe(4);
      expect(end.display.sides.second.cards.yellow).toBe(3);
    });

    it('the engine takes a card in the shootout', () => {
      expect(footballPadRules.eventAllowedInPhase('football.card', 'SHOOTOUT', SEED.cfg)).toBe(
        true,
      );
    });

    it.fails(
      'F-R4: Yellow is offered in the shootout, for E. Martínez’s booking during the kicks',
      async () => {
        const { shootoutButtons, shootoutMore } = (await replayed()).replay;
        const offered = [...shootoutButtons.first, ...shootoutMore];
        expect(offered).toContain('yellow.first');
      },
    );
  });

  describe('the shootout', () => {
    it('the kicks row follows every kick in order, France first', async () => {
      const { end } = (await replayed()).replay;
      expect(end.display.shootout?.kicks).toEqual(
        KICKS.map((kick) => ({ side: kick.side, scored: kick.scored })),
      );
      expect(end.display.shootout?.scored).toEqual({ first: 4, second: 2 });
    });

    it('it is decided after kick 8, not before, and no ninth kick is offered', async () => {
      const { kicks, replay: r } = await replayed();
      expect(kicks.map((seen) => seen.display.phase)).toEqual([
        ...Array<string>(7).fill('shootout'),
        'decided',
      ]);
      expect(r.end.kickButtons).toEqual([
        { id: 'scored.first', enabled: false },
        { id: 'missed.first', enabled: false },
        { id: 'scored.second', enabled: false },
        { id: 'missed.second', enabled: false },
      ]);
    });

    it.fails(
      'F-R3 (follows from it): every kick names its taker; Dybala is on the pitch',
      async () => {
        const { kicks } = await replayed();
        expect(kicks.map((seen) => seen.missing)).toEqual(Array<null>(KICKS.length).fill(null));
      },
    );
  });
});

// F-R1, proved on its own: a sub was stamped with the fold's `asOf` (the newest stamp), not the clock, so two subs by one
// team half an hour apart with nothing stamped between them shared a stamp, and the engine counted ONE window. Since
// ruling 154 each takes its own reading: two windows.
describe('two subs 30 minutes apart, nothing between them', () => {
  it('F-R1: are two windows, at 10 and 40', async () => {
    vi.setSystemTime(new Date(KICK_OFF_MS - 60_000));
    const scorer = await opened();
    scorer.press((actions) => actions.start());
    await flush();
    await scorer.startClock();
    await scorer.to(elapsedAt({ minute: 10 }));
    await scorer.tapThrough('sub.first', [
      { id: `p.${arg(26)}` },
      { id: `p.${arg(4)}` },
      { id: 'normalSub' },
    ]);
    await scorer.to(elapsedAt({ minute: 40 }));
    await scorer.tapThrough('sub.first', [
      { id: `p.${arg(11)}` },
      { id: `p.${arg(8)}` },
      { id: 'normalSub' },
    ]);
    const ledger = await scorer.ledger();
    const envelopes = ledger.map((event) => envelopeOf(SEED.fixtureId, event));
    const state = foldMatch(
      football,
      ENGINE_MATCH.cfg,
      ENGINE_MATCH.lineups,
      envelopes,
    ) as FootballState;
    expect(ledger.filter((event) => event.type === 'football.sub')).toHaveLength(2);
    expect((state.squads.home.subWindows ?? []).map(minuteOf)).toEqual(["10'", "40'"]);
  });
});

// Ruling 154 at the board: Sub is asked with the stamp a sub would get NOW. A team with its three windows spent may still
// join the stoppage it made for 120 s; past that, Sub reads "No subs left" with nothing else tapped (the pad redraws when
// the stoppage closes on a running clock), where before it stayed on until someone stamped an event (F-R1).
describe('a team with its windows spent, after its last sub', () => {
  it('Sub stays on for 120 s past the stoppage, then is off with nothing else tapped', async () => {
    vi.setSystemTime(new Date(KICK_OFF_MS - 60_000));
    const scorer = await opened();
    scorer.press((actions) => actions.start());
    await flush();
    await scorer.startClock();
    const pairs = [
      [26, 4],
      [11, 8],
      [7, 5],
    ] as const;
    for (const [i, [off, on]] of pairs.entries()) {
      await scorer.to(elapsedAt({ minute: 10 * (i + 1) }));
      await scorer.tapThrough('sub.first', [
        { id: `p.${arg(off)}` },
        { id: `p.${arg(on)}` },
        { id: 'normalSub' },
      ]);
    }
    const ledger = await scorer.ledger();
    expect(ledger.filter((event) => event.type === 'football.sub')).toHaveLength(3);
    // Sub was pressed for the third at 29:30, its stamp: the stoppage is open to 31:30 on the clock and closed at 31:31.
    // The final runs the concussion trial, so Sub itself stays on (ruling 155): its note says the ordinary subs are out.
    const sub = () => {
      const button = footballBoard(scorer.pad.display, scorer.pad.view.card).columns[0].actions[3];
      return [button?.enabled, button?.note?.key ?? null, scorer.pad.display.subsLeft.first];
    };
    await scorer.to(elapsedAt({ minute: 31 }, 15));
    expect(sub()).toEqual([true, null, true]);
    await scorer.to(elapsedAt({ minute: 32 }, 40));
    expect(sub()).toEqual([true, 'scoring.football.column.noSubs', false]);
    // The other team has used no window: its ordinary subs are all there.
    expect(scorer.pad.display.subsLeft.second).toBe(true);
    scorer.view.unmount();
  });
});
