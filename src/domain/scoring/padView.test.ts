import { describe, expect, it } from 'vitest';
import {
  cardPlacement,
  holdsScreen,
  matchKnown,
  withCard,
  type PadStateCard,
  type PadView,
} from '@/domain/scoring/padView';

type Key =
  | 'k.hint'
  | 'k.hintLine'
  | 'k.sub'
  | 'k.periods'
  | 'k.serving'
  | 'k.servingSaid'
  | 'k.tool'
  | 'k.last'
  | 'k.strip'
  | 'k.tally'
  | 'k.ruleLabel'
  | 'k.ruleValue'
  | 'k.ask';

/** A pad mid-game, any sport: both halves take taps, one tool, a last tap this phone can take back. */
const live: PadView<Key> = {
  halves: [
    {
      side: 'first',
      label: 'Top',
      value: '3',
      periods: { scores: [{ value: '7', won: true }], said: [{ key: 'k.periods' }] },
      sub: { key: 'k.sub' },
      serving: { shown: { key: 'k.serving' }, said: { key: 'k.servingSaid' } },
      bar: 'lit',
      hint: { key: 'k.hint' },
      hintLine: { key: 'k.hintLine' },
      tappable: true,
    },
    {
      side: 'second',
      label: 'Bottom',
      value: '1',
      periods: null,
      sub: null,
      serving: null,
      bar: 'dim',
      hint: { key: 'k.hint' },
      hintLine: { key: 'k.hintLine' },
      tappable: true,
    },
  ],
  tally: { shown: '0:0', said: { key: 'k.tally' } },
  details: {
    context: {
      competition: 'Spring Open 2026',
      division: null,
      round: null,
      match: null,
      sides: ['A', 'B'],
    },
    rules: [{ label: { key: 'k.ruleLabel' }, value: { key: 'k.ruleValue' } }],
  },
  start: null,
  strip: [{ slot: 'context', text: { key: 'k.strip' } }],
  lastTap: { text: { key: 'k.last' }, undo: true },
  sync: { kind: 'synced' },
  tools: [{ id: 't', label: { key: 'k.tool' }, detail: null, kind: 'standard', enabled: true }],
  card: null,
};

const CARDS: readonly PadStateCard[] = [
  { kind: 'notStarted' },
  { kind: 'resultRecorded' },
  { kind: 'viewOnly' },
  { kind: 'linkInvalid' },
  { kind: 'updateNeeded', unsent: 3 },
];

describe('cardPlacement', () => {
  // Owner ruling 8: an app too old to score keeps its pad on screen, view only, with the update banner. The banner
  // stands where the controls were (its buttons are the way on), so the halves keep the room a score needs.
  it('puts a card with nothing to score in place of the pad, the update banner in the controls’ place', () => {
    expect(CARDS.map((card) => [card.kind, cardPlacement(card)])).toEqual([
      ['notStarted', 'instead'],
      ['resultRecorded', 'withScore'],
      ['viewOnly', 'withScore'],
      ['linkInvalid', 'instead'],
      ['updateNeeded', 'forControls'],
    ]);
  });
});

describe('matchKnown', () => {
  // Owner ruling 15: the Rules button shows whenever the match's config is known; ruling 21: History whenever there is a
  // match. Both: on the pad and under every card but a dead link's, which names no match.
  it('knows the match on the pad and under every card but a bad link', () => {
    expect(matchKnown(null)).toBe(true);
    expect(CARDS.map((card) => [card.kind, matchKnown(card)])).toEqual([
      ['notStarted', true],
      ['resultRecorded', true],
      ['viewOnly', true],
      ['linkInvalid', false],
      ['updateNeeded', true],
    ]);
  });
});

describe('holdsScreen', () => {
  // Owner ruling 9 (the screen stays on while the pad shows), applied by the controller on 2026-11-02: a pad the scorer
  // is waiting to score on, or to undo a mistake on, holds the screen. A card that needs a person to act, or ends the
  // scorer's part (the organiser's lock, a dead link, an app to update, as the full-screen `outdated` state), has nothing
  // left to wait for, and the phone sleeps as it would anywhere.
  it('holds the screen on the pad and under the two cards the scorer still waits on', () => {
    expect(holdsScreen(null)).toBe(true);
    expect(CARDS.map((card) => [card.kind, holdsScreen(card)])).toEqual([
      ['notStarted', true],
      ['resultRecorded', true],
      ['viewOnly', false],
      ['linkInvalid', false],
      ['updateNeeded', false],
    ]);
  });
});

describe('withCard', () => {
  it('leaves a pad with no card as it is', () => {
    expect(withCard(live, null)).toBe(live);
  });

  it.each(CARDS)('stops the halves taking taps and takes the tools away under $kind', (card) => {
    const carded = withCard(live, card);
    expect(carded.card).toEqual(card);
    expect(carded.halves.map((half) => half.tappable)).toEqual([false, false]);
    expect(carded.tools).toEqual([]);
    // The score, the strip and the sync status are the pad's own: a card never changes them.
    expect(carded.halves.map((half) => half.value)).toEqual(['3', '1']);
    expect(carded.strip).toBe(live.strip);
    expect(carded.sync).toBe(live.sync);
  });

  it('keeps Undo under a recorded result, whose card says to use it on a mistake of this phone’s own', () => {
    expect(withCard(live, { kind: 'resultRecorded' }).lastTap).toEqual({
      text: { key: 'k.last' },
      undo: true,
    });
  });

  it('keeps the last tap but offers no Undo on a view-only pad', () => {
    expect(withCard(live, { kind: 'viewOnly' }).lastTap).toEqual({
      text: { key: 'k.last' },
      undo: false,
    });
  });

  it.each([
    { kind: 'notStarted' },
    { kind: 'linkInvalid' },
    { kind: 'updateNeeded', unsent: 2 },
  ] as const)('drops the last tap with the pad or the controls under $kind', (card) => {
    expect(withCard(live, card).lastTap).toBeNull();
  });

  // Owner, 2026-11-01: nothing is started under a card (a view-only phone, a dead link, an app too old to score).
  it.each(CARDS)('takes the Start screen away under $kind', (card) => {
    const asking: PadView<Key> = {
      ...live,
      start: {
        ask: { key: 'k.ask' },
        sides: [
          { side: 'first', label: 'A' },
          { side: 'second', label: 'B' },
        ],
      },
    };
    expect(withCard(asking, card).start).toBeNull();
    expect(withCard(asking, null).start).toBe(asking.start);
  });

  it('replaces a card already there (a preview card over a recorded result)', () => {
    const recorded = withCard(live, { kind: 'resultRecorded' });
    const viewOnly = withCard(recorded, { kind: 'viewOnly' });
    expect(viewOnly.card).toEqual({ kind: 'viewOnly' });
    expect(viewOnly.lastTap?.undo).toBe(false);
  });
});
