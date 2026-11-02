import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  PHONE_LINK,
  SINGLES,
  eventId,
  ledgerOf,
  queuedOf,
  rally,
  start,
} from '../../../test/badmintonLedger';
import { NOW, drive, opened, queueOf, ready, tapped } from '../../../test/scoringMatchFixtures';

// What the screen shows of a match (plan S2-1 Task 9): the pad under the card that matters most, or the state that takes
// its place. Literal expectations; the words are dictionary keys.

const AT = '2026-11-02T09:00:00.000Z';
const padOf = (state: Parameters<typeof viewOf>[0]) => {
  const view = viewOf(state);
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view;
};

describe('the states that take the pad’s place', () => {
  it('no bootstrap and no news of the link: loading, and offline once the first read could not be made', () => {
    const state = opened({ bootstrap: null });
    expect(viewOf(state)).toEqual({ kind: 'loading', offline: false });
    const failed = step(
      state,
      { kind: 'bootstrapFailed', failure: { kind: 'offline' } },
      NOW,
    ).state;
    expect(viewOf(failed)).toEqual({ kind: 'loading', offline: true });
  });

  it('no bootstrap and a link the door does not take: the link is gone', () => {
    const state = opened({ bootstrap: null });
    const gone = step(
      state,
      { kind: 'bootstrapFailed', failure: { kind: 'linkDead', code: 'LINK_REVOKED' } },
      NOW,
    ).state;
    expect(viewOf(gone)).toEqual({ kind: 'linkGone' });
  });

  it('a sport this build does not score, named', () => {
    expect(viewOf(ready({ bootstrap: { ...SINGLES, sportKey: 'tabletennis' } }))).toEqual({
      kind: 'unsupportedSport',
      sportKey: 'tabletennis',
    });
  });

  it('a ledger over the read’s cap', () => {
    const state = step(ready(), { kind: 'fetchFailed', failure: { kind: 'tooLarge' } }, NOW).state;
    expect(viewOf(state)).toEqual({ kind: 'tooLarge' });
  });

  it.each([
    ['a seat with no entrant', { ...SINGLES, sides: { ...SINGLES.sides, away: null } }, 'sides'],
    ['a config the engine refuses', { ...SINGLES, cfg: { bestOf: 'many' } }, 'cfg'],
  ] as const)('%s cannot be folded: said, with the reason', (_name, bootstrap, reason) => {
    expect(viewOf(ready({ bootstrap }))).toEqual({ kind: 'unfoldable', reason });
  });

  it('an app too old, and a match that cannot be folded: the banner’s count of unsent taps', () => {
    const base = opened({
      ...tapped([queuedOf('k1', rally('H')), queuedOf('k2', rally('A'))]),
      bootstrap: { ...SINGLES, cfg: { bestOf: 'many' }, epochRequired: 3 },
    });
    expect(viewOf(base)).toEqual({ kind: 'outdated', unsent: 2 });
  });
});

describe('the pad and its card', () => {
  it('an ordinary match is the pad with no card, synced, its halves tapping', () => {
    const { view, history } = padOf(ready());
    expect(view.card).toBeNull();
    expect(view.sync).toEqual({ kind: 'synced' });
    expect(view.halves.map((half) => half.tappable)).toEqual([true, true]);
    expect(history.map((group) => [group.heading.key, group.rows.length])).toEqual([
      ['scoring.badminton.gameHeading', 1],
    ]);
  });

  it.each([
    ['a link the door does not take', { dead: 'LINK_REVOKED' as const }, { kind: 'linkInvalid' }],
    ['a match gone', { dead: 'gone' as const }, { kind: 'linkInvalid' }],
    ['an account to pay', { dead: 'payment' as const }, { kind: 'linkInvalid' }],
    ['a forbidden write', { dead: 'forbidden' as const }, { kind: 'linkInvalid' }],
    ['a finalized match', { dead: 'finalized' as const }, { kind: 'viewOnly' }],
    ['a cancelled match', { dead: 'cancelled' as const }, { kind: 'viewOnly' }],
  ])('%s is a card over the pad, its halves not tapping', (_name, { dead }, card) => {
    const { view } = padOf(ready({ queue: queueOf({ dead }) }));
    expect(view.card).toEqual(card);
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('the server’s view-only screen is the view-only card, with no taps', () => {
    expect(padOf(ready({ bootstrap: { ...SINGLES, screen: 'viewOnly' } })).view.card).toEqual({
      kind: 'viewOnly',
    });
  });

  it.each(['divisionNotStarted', 'waiting'] as const)(
    'the %s screen is the not-started card',
    (screen) => {
      expect(padOf(ready({ bootstrap: { ...SINGLES, screen } })).view.card).toEqual({
        kind: 'notStarted',
      });
    },
  );

  it('the confirm screen is the Start screen, with no card', () => {
    const { view } = padOf(ready({ bootstrap: { ...SINGLES, screen: 'confirm' } }, []));
    expect(view.card).toBeNull();
    expect(view.start).not.toBeNull();
  });

  it('a server that needs a newer app is the update card with the count of unsent taps, the pad still showing', () => {
    const state = ready({ bootstrap: { ...SINGLES, epochRequired: 3 } });
    expect(padOf(state).view.card).toEqual({ kind: 'updateNeeded', unsent: 0 });
  });

  it('a 426 answer is the update card too, naming what is still unsent', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    const send = read.effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []))[0];
    const old = step(
      read.state,
      { kind: 'answered', sent: send.sent, answer: { kind: 'outdated', required: 3 } },
      NOW,
    ).state;
    expect(padOf(old).view.card).toEqual({ kind: 'updateNeeded', unsent: 1 });
  });

  it('a card of a dead link outranks the update card, and a closed match outranks it too', () => {
    const base = { ...SINGLES, epochRequired: 3 };
    expect(
      padOf(ready({ bootstrap: base, queue: queueOf({ dead: 'LINK_REVOKED' }) })).view.card,
    ).toEqual({ kind: 'linkInvalid' });
    expect(
      padOf(ready({ bootstrap: base, queue: queueOf({ dead: 'finalized' }) })).view.card,
    ).toEqual({ kind: 'viewOnly' });
  });

  it('a decided match is the recorded result’s card, from the fold', () => {
    const decided = [start(), ...Array.from({ length: 42 }, () => rally('H'))];
    expect(padOf(ready({}, decided)).view.card).toEqual({ kind: 'resultRecorded' });
  });

  it('a closure a read brought, with nothing queued, is a card though the queue is not dead', () => {
    const state = step(
      ready(),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    ).state;
    expect(padOf(state).view.card).toEqual({ kind: 'viewOnly' });
  });
});

describe('what the pad says of the transport', () => {
  const unsent = (extra: Parameters<typeof opened>[0] = {}) =>
    opened({ ...tapped([queuedOf('k1', rally('H')), queuedOf('k2', rally('A'))]), ...extra });

  it('nothing queued is synced; taps queued are sending', () => {
    expect(padOf(ready()).view.sync).toEqual({ kind: 'synced' });
    expect(padOf(unsent()).view.sync).toEqual({ kind: 'sending', count: 2 });
  });

  it('a send that found no network is offline, with the count', () => {
    const read = step(unsent(), { kind: 'fetched', events: [] }, NOW);
    const send = read.effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []))[0];
    const down = step(
      read.state,
      { kind: 'answered', sent: send.sent, answer: { kind: 'offline' } },
      NOW,
    ).state;
    expect(padOf(down).view.sync).toEqual({ kind: 'offline', count: 2 });
  });

  it('taps kept in a dead queue are refused, with the count', () => {
    expect(
      padOf(
        unsent({ queue: queueOf({ pending: [queuedOf('k1', rally('H'))], dead: 'LINK_REVOKED' }) }),
      ).view.sync,
    ).toEqual({
      kind: 'refused',
      count: 1,
    });
  });
});

describe('the last-tap line', () => {
  it('shows the reducer’s own words when it has some', () => {
    const state = step(
      ready(),
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    ).state;
    expect(padOf(state).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('says another scorer has scored since, as a standing note, while that keeps Undo off', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }, rally('A')]);
    const state = ready({ ledger, queue: queueOf({ ownEventIds: [eventId(2)] }) });
    expect(padOf(state).line).toEqual({ kind: 'note', key: 'scoring.pad.otherScorerSince' });
    expect(padOf(state).view.lastTap?.undo).toBe(false);
  });

  it('says nothing of another scorer when this phone’s last event is the last in the match', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]);
    const state = ready({ ledger, queue: queueOf({ ownEventIds: [eventId(2)] }) });
    expect(padOf(state).line).toBeNull();
    expect(padOf(state).view.lastTap?.undo).toBe(true);
  });

  it('a tap discarded by Undo leaves its "undone" sentence while the match is as it was left, and no longer', () => {
    const queued = drive(ready(), [
      { kind: 'tap', tap: { kind: 'rally', side: 'first' }, key: 'k1', at: AT },
    ]).state;
    const undone = step(queued, { kind: 'undo', key: 'u1', at: AT }, NOW).state;
    expect(padOf(undone).view.lastTap?.text).toEqual({
      key: 'scoring.badminton.undone.rally',
      vars: { side: 'A. Sharma' },
    });
    const moved = step(
      undone,
      { kind: 'tap', tap: { kind: 'rally', side: 'second' }, key: 'k2', at: AT },
      NOW,
    ).state;
    expect(padOf(moved).view.lastTap?.text.key).toBe('scoring.badminton.last.rally');
    const grown = step(
      undone,
      { kind: 'fetched', events: ledgerOf([start(), rally('A')]).slice(1) },
      NOW,
    ).state;
    expect(padOf(grown).view.lastTap?.text.key).not.toBe('scoring.badminton.undone.rally');
  });
});

describe('the Start screen’s pick', () => {
  it('is shown while the match has not started and goes once it has', () => {
    const before = ready({ toss: 'second' }, []);
    expect(padOf(before).toss).toBe('second');
    expect(padOf(ready({ toss: 'second' })).toss).toBeNull();
  });
});

describe('the match is counted once while a tap is in flight', () => {
  it('a ledger that already holds the sent tap does not score it a second time', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    const copy = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const merged = step(read.state, { kind: 'fetched', events: copy }, NOW).state;
    expect(padOf(merged).view.halves.map((half) => half.value)).toEqual(['1', '0']);
  });

  it('and while its copy is not in yet the tap counts once, from the queue', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    expect(padOf(read.state).view.halves.map((half) => half.value)).toEqual(['1', '0']);
  });
});
