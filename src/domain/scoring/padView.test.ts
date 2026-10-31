import { describe, expect, it } from 'vitest';
import { cardPlacement, withCard, type PadStateCard, type PadView } from '@/domain/scoring/padView';

type Key = 'k.hint' | 'k.sub' | 'k.tool' | 'k.last' | 'k.strip';

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
      tappable: true,
    },
    {
      side: 'second',
      label: 'Bottom',
      value: '1',
      sub: null,
      serving: false,
      hint: { key: 'k.hint' },
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
  it('puts a card with nothing to score in place of the pad, and keeps the score beside a finished one', () => {
    expect(CARDS.map((card) => [card.kind, cardPlacement(card)])).toEqual([
      ['notStarted', 'instead'],
      ['resultRecorded', 'withScore'],
      ['viewOnly', 'withScore'],
      ['linkInvalid', 'instead'],
      ['updateNeeded', 'instead'],
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
    { kind: 'updateNeeded', unsent: 0 },
  ] as const)('drops the last tap with the pad under $kind', (card) => {
    expect(withCard(live, card).lastTap).toBeNull();
  });

  it('replaces a card already there (a preview card over a recorded result)', () => {
    const recorded = withCard(live, { kind: 'resultRecorded' });
    const viewOnly = withCard(recorded, { kind: 'viewOnly' });
    expect(viewOnly.card).toEqual({ kind: 'viewOnly' });
    expect(viewOnly.lastTap?.undo).toBe(false);
  });
});
