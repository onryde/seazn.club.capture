import { describe, expect, it } from 'vitest';
import {
  IDLE,
  LOADING_MS,
  NOT_READY_MS,
  SHOWING_MS,
  viewerCheck,
  type ViewerCheck,
  type ViewerEvent,
} from '@/domain/session/viewerCheck';

const T = 1_000_000;
const loading: ViewerCheck = { kind: 'loading', until: T + 5_000 };
const showing: ViewerCheck = { kind: 'showing', until: T + 3_000 + 20_000 };
const notReady: ViewerCheck = { kind: 'notReady', until: T + 5_000 + 3_000 };

/** Spec §4.3's diagram, row by row. Every number is the spec's: 5 s, 20 s from the first frame, 3 s. */
describe('What viewers see, the rule (D2 §4.3, R2, R10)', () => {
  it('has the spec’s three times', () => {
    expect([LOADING_MS, SHOWING_MS, NOT_READY_MS]).toEqual([5_000, 20_000, 3_000]);
  });

  it.each<[string, ViewerCheck, ViewerEvent, ViewerCheck]>([
    ['idle, a tap: loading for 5 s', IDLE, { kind: 'tap', at: T }, loading],
    [
      'loading, the first frame: showing for 20 s from it',
      loading,
      { kind: 'firstFrame', at: T + 3_000 },
      showing,
    ],
    [
      'loading, the 5 s are up with no frame: not ready for 3 s',
      loading,
      { kind: 'deadline', at: T + 5_000 },
      notReady,
    ],
    ['showing, the 20 s are up: idle', showing, { kind: 'deadline', at: T + 23_000 }, IDLE],
    ['not ready, the 3 s are up: idle', notReady, { kind: 'deadline', at: T + 8_000 }, IDLE],
    ['loading, a tap: idle', loading, { kind: 'tap', at: T + 1_000 }, IDLE],
    ['showing, a tap: idle, never a longer view', showing, { kind: 'tap', at: T + 10_000 }, IDLE],
    ['not ready, a tap: idle', notReady, { kind: 'tap', at: T + 6_000 }, IDLE],
    [
      'loading, closed (shed, off air, the scoring panel, no URL): idle',
      loading,
      { kind: 'close' },
      IDLE,
    ],
    ['showing, closed: idle', showing, { kind: 'close' }, IDLE],
    ['not ready, closed: idle', notReady, { kind: 'close' }, IDLE],
    ['idle, closed: idle', IDLE, { kind: 'close' }, IDLE],
  ])('%s', (_name, state, event, next) => {
    expect(viewerCheck(state, event)).toEqual(next);
  });

  it.each<[string, ViewerCheck, ViewerEvent]>([
    [
      'a second first frame while showing does not restart the 20 s',
      showing,
      { kind: 'firstFrame', at: T + 15_000 },
    ],
    [
      'a deadline before its time changes nothing (loading)',
      loading,
      { kind: 'deadline', at: T + 4_999 },
    ],
    [
      'a deadline before its time changes nothing (showing)',
      showing,
      { kind: 'deadline', at: T + 22_999 },
    ],
    [
      'a stale frame on the not-ready line changes nothing',
      notReady,
      { kind: 'firstFrame', at: T + 6_000 },
    ],
    ['a frame or a deadline while idle changes nothing', IDLE, { kind: 'deadline', at: T }],
    ['a frame while idle changes nothing', IDLE, { kind: 'firstFrame', at: T }],
  ])('%s', (_name, state, event) => {
    expect(viewerCheck(state, event)).toBe(state);
  });

  it('a tap after closing opens a new view from that tap: a view cannot be extended, only begun again', () => {
    const closed = viewerCheck(showing, { kind: 'tap', at: T + 10_000 });
    expect(closed).toEqual(IDLE);
    expect(viewerCheck(closed, { kind: 'tap', at: T + 10_500 })).toEqual({
      kind: 'loading',
      until: T + 15_500,
    });
  });

  it('bounds a view at 25 s of player time with a picture, and 8 s without one (spec §4.3)', () => {
    let state = viewerCheck(IDLE, { kind: 'tap', at: T });
    state = viewerCheck(state, { kind: 'firstFrame', at: T + 4_999 });
    expect(state.kind === 'showing' && state.until - T).toBe(24_999);
    let none = viewerCheck(IDLE, { kind: 'tap', at: T });
    none = viewerCheck(none, { kind: 'deadline', at: T + 5_000 });
    expect(none.kind === 'notReady' && none.until - T).toBe(8_000);
  });
});
