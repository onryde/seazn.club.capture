import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import {
  viewerFeed,
  type DeliveryWord,
  type Feed,
  type FeedInput,
} from '@/domain/session/viewerFeed';

type Kind = SessionState['kind'];
const KINDS: Record<Kind, true> = {
  idle: true,
  pairing: true,
  paired: true,
  arming: true,
  armed: true,
  connecting: true,
  publishing: true,
  degraded: true,
  reconnecting: true,
  ended: true,
};
const DELIVERIES: readonly DeliveryWord[] = ['ok', 'stalled', 'unknown'];

const base: FeedInput = {
  kind: 'publishing',
  hasUrl: true,
  delivery: 'unknown',
  everDelivered: false,
  playerFailed: false,
};
const row = (change: Partial<FeedInput>): Feed => viewerFeed({ ...base, ...change });

describe('what the viewer layer shows (spec §9, D6 to D8)', () => {
  // D2 §4.3: the view's own 5 s countdown is the patience now. Before the first window the layer waits, however long.
  it('waits for the first window with no patience of its own', () => {
    expect(
      viewerFeed({
        kind: 'publishing',
        hasUrl: true,
        delivery: 'unknown',
        everDelivered: false,
        playerFailed: false,
      }),
    ).toBe('waiting');
  });

  it('the rulebook, row by row', () => {
    const rows: [string, Feed, Feed][] = [
      ['no url, publishing, ok', row({ hasUrl: false, delivery: 'ok' }), 'none'],
      ['paired, ok', row({ kind: 'paired', delivery: 'ok' }), 'none'],
      ['ended, ok', row({ kind: 'ended', delivery: 'ok', everDelivered: true }), 'none'],
      ['arming', row({ kind: 'arming' }), 'waiting'],
      ['armed', row({ kind: 'armed' }), 'waiting'],
      ['connecting', row({ kind: 'connecting' }), 'waiting'],
      ['publishing, no window yet', row({}), 'waiting'],
      ['publishing, first window now', row({ delivery: 'ok' }), 'playing'],
      [
        'publishing, latched, one poll failed',
        row({ delivery: 'unknown', everDelivered: true }),
        'playing',
      ],
      ['publishing, stalled', row({ delivery: 'stalled', everDelivered: true }), 'unavailable'],
      ['degraded, window', row({ kind: 'degraded', delivery: 'ok' }), 'playing'],
      [
        'reconnecting (a hold), latched',
        row({ kind: 'reconnecting', delivery: 'unknown', everDelivered: true }),
        'unavailable',
      ],
      ['reconnecting, never delivered', row({ kind: 'reconnecting' }), 'unavailable'],
      [
        'playing but the player gave up',
        row({ delivery: 'ok', playerFailed: true }),
        'unavailable',
      ],
    ];
    expect(rows).toHaveLength(14);
    for (const [name, got, want] of rows) expect(got, name).toBe(want);
  });

  it('M24 never plays unless a window was seen, over the whole input space', () => {
    let checked = 0;
    let played = 0;
    for (const kind of Object.keys(KINDS) as Kind[])
      for (const delivery of DELIVERIES)
        for (const everDelivered of [false, true])
          for (const hasUrl of [false, true])
            for (const playerFailed of [false, true]) {
              const feed = row({ kind, delivery, everDelivered, hasUrl, playerFailed });
              checked += 1;
              if (!hasUrl) expect(feed).toBe('none');
              if (feed === 'playing') {
                played += 1;
                expect(['publishing', 'degraded']).toContain(kind);
                expect(everDelivered || delivery === 'ok').toBe(true);
                expect(delivery).not.toBe('stalled');
                expect(playerFailed).toBe(false);
              }
            }
    expect(checked).toBe(10 * 3 * 2 * 2 * 2);
    expect(played).toBeGreaterThan(0);
  });

  it('the whole input space against the rulebook as a table, not as the rule', () => {
    // D6 and D7 written out by hand: one answer per (delivery, everDelivered, playerFailed) for a live kind with a
    // url. `ok` or a latched window is a window; a stalled word is never played; with no window it waits (the view's
    // own countdown is the patience, D2 §4.3); a failed player is `unavailable` only where a player would have been
    // mounted.
    const LIVE_TABLE: Record<string, Feed> = {
      'ok/latched/player-ok': 'playing',
      'ok/latched/player-failed': 'unavailable',
      'ok/fresh/player-ok': 'playing',
      'ok/fresh/player-failed': 'unavailable',
      'stalled/latched/player-ok': 'unavailable',
      'stalled/latched/player-failed': 'unavailable',
      'stalled/fresh/player-ok': 'unavailable',
      'stalled/fresh/player-failed': 'unavailable',
      'unknown/latched/player-ok': 'playing',
      'unknown/latched/player-failed': 'unavailable',
      'unknown/fresh/player-ok': 'waiting',
      'unknown/fresh/player-failed': 'waiting',
    };
    expect(Object.keys(LIVE_TABLE)).toHaveLength(3 * 2 * 2);

    const expectedFor = (kind: Kind, hasUrl: boolean, key: string): Feed => {
      if (!hasUrl) return 'none';
      switch (kind) {
        case 'idle':
        case 'pairing':
        case 'paired':
        case 'ended':
          return 'none';
        case 'arming':
        case 'armed':
        case 'connecting':
          return 'waiting';
        case 'reconnecting':
          return 'unavailable';
        case 'publishing':
        case 'degraded':
          return LIVE_TABLE[key]!;
      }
    };

    const tally: Record<Feed, number> = { none: 0, waiting: 0, playing: 0, unavailable: 0 };
    let checked = 0;
    for (const kind of Object.keys(KINDS) as Kind[])
      for (const hasUrl of [false, true])
        for (const delivery of DELIVERIES)
          for (const everDelivered of [false, true])
            for (const playerFailed of [false, true]) {
              const key = [
                delivery,
                everDelivered ? 'latched' : 'fresh',
                playerFailed ? 'player-failed' : 'player-ok',
              ].join('/');
              const want = expectedFor(kind, hasUrl, key);
              const got = row({ kind, hasUrl, delivery, everDelivered, playerFailed });
              checked += 1;
              tally[want] += 1;
              if (got !== want)
                expect({ kind, hasUrl, key, got }).toEqual({ kind, hasUrl, key, got: want });
            }
    expect(checked).toBe(10 * 2 * 3 * 2 * 2);
    // Every answer is reached (a feed nobody can produce would pass unseen), and the cells add up to 240. Counted
    // by hand from the table: it holds 3 playing, 2 waiting and 7 unavailable, for each of the two live kinds.
    expect(tally.none).toBe(120 + 4 * 12); // no url, then the four kinds with nothing to show
    expect(tally.waiting).toBe(3 * 12 + 2 * 2); // arming, armed, connecting; then the live kinds' two
    expect(tally.unavailable).toBe(12 + 2 * 7); // a hold; then the live kinds' seven
    expect(tally.playing).toBe(2 * 3);
    expect(tally.none + tally.waiting + tally.unavailable + tally.playing).toBe(checked);
  });

  it('a broadcast, in order: the first window, a blip, a hold, and the next window (D7)', () => {
    // The hook's inputs over time, as the hook is specified to produce them: the latch is set by the first `ok`
    // and cleared by the hold. The rule alone must follow.
    const timeline: [string, Partial<FeedInput>, Feed][] = [
      ['going live', { kind: 'connecting' }, 'waiting'],
      ['published, no window', { kind: 'publishing' }, 'waiting'],
      ['first window', { kind: 'publishing', delivery: 'ok', everDelivered: true }, 'playing'],
      [
        'one poll fails',
        { kind: 'publishing', delivery: 'unknown', everDelivered: true },
        'playing',
      ],
      [
        'the hold',
        { kind: 'reconnecting', delivery: 'unknown', everDelivered: false },
        'unavailable',
      ],
      ['back, playlist may be new', { kind: 'publishing', delivery: 'unknown' }, 'waiting'],
      ['the next window', { kind: 'publishing', delivery: 'ok', everDelivered: true }, 'playing'],
      ['the broadcast ends', { kind: 'ended', delivery: 'ok', everDelivered: true }, 'none'],
    ];
    expect(timeline).toHaveLength(8);
    const seen = timeline.map(([name, change]) => ({ name, got: row(change) }));
    expect(seen).toEqual(timeline.map(([name, , want]) => ({ name, got: want })));
  });
});
