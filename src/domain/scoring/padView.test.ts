import { describe, expect, it } from 'vitest';
import {
  cardPlacement,
  rulesKnown,
  withCard,
  type PadStateCard,
  type PadView,
} from '@/domain/scoring/padView';

type Key = 'k.hint' | 'k.hintLine' | 'k.sub' | 'k.tool' | 'k.last' | 'k.strip';

/** A pad mid-game, any sport: both halves take taps, one tool, a last tap this phone can take back. */
const live: PadView<Key> = {
  halves: [
    {
      side: 'first',
      label: 'Top',
      value: '3',
      sub: { key: 'k.sub' },
      serving: true,
      hint: { key: 'k.hint' },
      hintLine: { key: 'k.hintLine' },
      tappable: true,
    },
    {
      side: 'second',
      label: 'Bottom',
      value: '1',
      sub: null,
      serving: false,
      hint: { key: 'k.hint' },
      hintLine: { key: 'k.hintLine' },
      tappable: true,
    },
  ],
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

describe('rulesKnown', () => {
  // Owner ruling 15: the Rules button shows whenever the match's config is known: on the pad and under every card but a
  // dead link's, which names no match (the controller's brief, 2026-10-31).
  it('knows the rules on the pad and under every card but a bad link', () => {
    expect(rulesKnown(null)).toBe(true);
    expect(CARDS.map((card) => [card.kind, rulesKnown(card)])).toEqual([
      ['notStarted', true],
      ['resultRecorded', true],
      ['viewOnly', true],
      ['linkInvalid', false],
      ['updateNeeded', true],
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

  it('replaces a card already there (a preview card over a recorded result)', () => {
    const recorded = withCard(live, { kind: 'resultRecorded' });
    const viewOnly = withCard(recorded, { kind: 'viewOnly' });
    expect(viewOnly.card).toEqual({ kind: 'viewOnly' });
    expect(viewOnly.lastTap?.undo).toBe(false);
  });
});
