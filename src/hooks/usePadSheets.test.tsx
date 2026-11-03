import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PadAsk, PadStateCard } from '@/domain/scoring/padView';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import { viewAs } from '@/domain/scoring/scoringMatchView';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { usePadSheets, type PadSheetSnapshot } from '@/hooks/usePadSheets';
import { TEST_NOW, createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';
import { ledgerOf, queuedOf, rally, start } from '../../test/badmintonLedger';
import { NOW, held, queueOf } from '../../test/scoringMatchFixtures';

// The reconnect question's sheet over the cards (round 4, item 4): the scorer is asked over every card but a dead link's,
// where nothing can be sent or discarded and the question is moot. The snapshot is the real match's, read through the
// reducer; only the card is put on it.

/** The match as it stands with the question put: two taps queued, the web's rally brought in by the first read. */
function askedMatch(): MatchState {
  const queue = queueOf({ pending: [queuedOf('k1', rally('H')), queuedOf('k2', rally('H'))] });
  const web = ledgerOf([start(), rally('A')], '2026-11-01T10:31:00.000Z');
  const opened = openMatch(held({ queue }), NOW).state;
  return step(opened, { kind: 'fetched', events: web.slice(1) }, NOW).state;
}

function snapshotOf(card: PadStateCard | null): PadSheetSnapshot {
  const pad = viewAs(badmintonSport, askedMatch());
  if (pad.kind !== 'pad') throw new Error(`expected the pad, got ${pad.kind}`);
  return { display: pad.display, history: pad.history, card, ask: pad.ask };
}

const DRIVER = { sanction: () => ({ ok: true as const }), setScore: () => ({ ok: true as const }) };

function mount(initial: PadSheetSnapshot | null) {
  const fakes = createFakePorts();
  const view = renderHook(
    ({ snapshot }: { snapshot: PadSheetSnapshot | null }) =>
      usePadSheets(
        DRIVER,
        snapshot,
        () => true,
        () => undefined,
      ),
    { wrapper: wrapperFor(fakes), initialProps: { snapshot: initial } },
  );
  return { ...view, fakes };
}

const CARDS: readonly PadStateCard[] = [
  { kind: 'notStarted' },
  { kind: 'resultRecorded' },
  { kind: 'viewOnly' },
  { kind: 'updateNeeded', unsent: 2 },
];

describe('the reconnect question over the cards', () => {
  it('asks over the pad, with the counts and the server’s score', () => {
    const { result } = mount(snapshotOf(null));
    expect(result.current.view?.kind).toBe('ask');
    const ask = (result.current.view as { ask: PadAsk }).ask;
    expect(ask).toMatchObject({ foreign: 1, queued: 2 });
  });

  it.each(CARDS)('asks over the $kind card: the scorer can answer it there', (card) => {
    const { result } = mount(snapshotOf(card));
    expect(result.current.view?.kind).toBe('ask');
  });

  it('asks nothing over a dead link’s card: the question is moot there and no sheet stands', () => {
    const { result } = mount(snapshotOf({ kind: 'linkInvalid' }));
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it.each(CARDS)(
    'Discard’s confirm stands over the $kind card too, and Keep is the way back',
    (card) => {
      const { result, fakes } = mount(snapshotOf(card));
      act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
      act(() => result.current.actions.askDiscard());
      expect(result.current.view?.kind).toBe('discard');
      act(() => result.current.cancel());
      expect(result.current.view?.kind).toBe('ask');
    },
  );

  it('a dead link under an open confirm takes it away with the question', () => {
    const { result, rerender, fakes } = mount(snapshotOf(null));
    act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
    act(() => result.current.actions.askDiscard());
    expect(result.current.view?.kind).toBe('discard');
    rerender({ snapshot: snapshotOf({ kind: 'linkInvalid' }) });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('a confirm whose question has gone (answered, or taken back elsewhere) goes with it', () => {
    const { result, rerender, fakes } = mount(snapshotOf(null));
    act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
    act(() => result.current.actions.askDiscard());
    expect(result.current.view?.kind).toBe('discard');
    rerender({ snapshot: { ...snapshotOf(null), ask: null } });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('with no question the sheets are the pad’s own: a card under no question shows none', () => {
    const none: PadSheetSnapshot = { ...snapshotOf(null), ask: null };
    expect(mount(none).result.current.view).toBeNull();
    expect(mount({ ...none, card: { kind: 'viewOnly' } }).result.current.view).toBeNull();
  });
});
