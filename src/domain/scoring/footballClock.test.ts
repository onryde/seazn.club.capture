import { football, type FootballCfg } from '@seazn/engine/sports/football';
import { describe, expect, it } from 'vitest';
import {
  anchorBase,
  anchorOf,
  clockText,
  matchTime,
  minuteText,
  needsResync,
  newestStamp,
  PHASE_ORDER,
  periodLengths,
  reading,
  restamp,
  resyncTap,
  stampFor,
  subStamp,
  type AnchorEvent,
  type ClockAnchor,
} from '@/domain/scoring/footballClock';
import { at, KO_11, LEAGUE_11, MINI, PHONE_LINK } from '../../../test/footballLedger';

/**
 * The football clock, pure (S2-5 design §7; plan P Task 5; controller rulings 1–3). Every expected value is written out
 * from the design, the Laws (45:00 starts the second half, "90+3'" is the 91st-to-93rd minute being played) and the
 * web's vector table (ruling X-11), never computed by the code under test.
 */

/** The engine's config with its defaults, as the web's vector table means its shorthand. */
const cfgOf = (raw: unknown): FootballCfg => football.configSchema.parse(raw);
const DEFAULTS = cfgOf({});

const T0 = Date.parse('2026-11-07T12:00:00.000Z');
const SECOND = 1000;

const clockEvent = (
  running: boolean,
  stamp: { period: string; elapsed: number } | null,
  atMs: number,
  more: Partial<AnchorEvent> = {},
): AnchorEvent => ({
  type: 'football.clock',
  payload: stamp === null ? { running } : { running, at: stamp },
  atMs,
  base: 'server',
  standing: true,
  ...more,
});

const marker = (phase: string, atMs: number, standing = true): AnchorEvent => ({
  type: 'football.period',
  payload: { phase },
  atMs,
  base: 'server',
  standing,
});

const anchor = (more: Partial<ClockAnchor> = {}): ClockAnchor => ({
  period: 'H1',
  elapsed: 10,
  running: true,
  atMs: T0,
  base: 'server',
  ...more,
});

describe('the reading (design §7.2)', () => {
  it('reads 0:00 before any clock event', () => {
    expect(reading(null, { deviceMs: T0, offsetMs: 0 })).toBe(0);
  });

  it('running 75 s from an anchor at 10 s reads 85', () => {
    expect(reading(anchor(), { deviceMs: T0 + 75 * SECOND, offsetMs: 0 })).toBe(85);
  });

  it('a server anchor reads through the offset', () => {
    // The anchor arrived at server 12:00:00; the phone is 5 min slow and its own clock says 11:55:30.
    const phoneNow = Date.parse('2026-11-07T11:55:30.000Z');
    expect(reading(anchor({ elapsed: 600 }), { deviceMs: phoneNow, offsetMs: 300_000 })).toBe(630);
  });

  it('a device anchor ignores the offset', () => {
    // The phone's own tap at 11:55:00 by its own clock; 30 s later by the same clock, whatever the server says.
    const tapped = Date.parse('2026-11-07T11:55:00.000Z');
    const device = anchor({ elapsed: 600, atMs: tapped, base: 'device' });
    expect(reading(device, { deviceMs: tapped + 30 * SECOND, offsetMs: 300_000 })).toBe(630);
    expect(reading(device, { deviceMs: tapped + 30 * SECOND, offsetMs: -120_000 })).toBe(630);
  });

  it('a Pause freezes the reading', () => {
    const paused = anchor({ elapsed: 1234, running: false });
    expect(reading(paused, { deviceMs: T0 + 600 * SECOND, offsetMs: 0 })).toBe(1234);
  });

  it('floors to whole seconds and never runs backwards before its anchor', () => {
    expect(reading(anchor(), { deviceMs: T0 + 1999, offsetMs: 0 })).toBe(11);
    expect(reading(anchor(), { deviceMs: T0 - 5 * SECOND, offsetMs: 0 })).toBe(10);
  });
});

describe('the anchor (design §7.2, ruling X-8)', () => {
  it('is the latest standing clock event of the phase', () => {
    const events = [
      clockEvent(true, at('H1', 0), T0),
      clockEvent(false, at('H1', 300), T0 + 300 * SECOND),
    ];
    expect(anchorOf(events, 'H1')).toEqual({
      period: 'H1',
      elapsed: 300,
      running: false,
      atMs: T0 + 300 * SECOND,
      base: 'server',
    });
  });

  it('has none before a clock event in the period', () => {
    expect(anchorOf([], 'H1')).toBeNull();
    expect(
      anchorOf(
        [{ type: 'core.start', payload: {}, atMs: T0, base: 'server', standing: true }],
        'H1',
      ),
    ).toBeNull();
  });

  it('a period marker ends the anchor', () => {
    const events = [clockEvent(true, at('H1', 0), T0), marker('HT', T0 + 2700 * SECOND)];
    expect(anchorOf(events, 'H2')).toBeNull();
    // The whistle stops its own period's clock too (`football.period` sets `clockRunning: false`): no running H1 anchor.
    expect(anchorOf(events, 'H1')).toBeNull();
  });

  it('an unstamped Start after a marker does not carry the last period’s clock', () => {
    const events = [
      clockEvent(true, at('H1', 0), T0),
      marker('HT', T0 + 2700 * SECOND),
      clockEvent(true, null, T0 + 2900 * SECOND),
    ];
    expect(anchorOf(events, 'H2')).toBeNull();
  });

  it('a voided marker does not end it', () => {
    const events = [clockEvent(true, at('H1', 0), T0), marker('HT', T0 + 2700 * SECOND, false)];
    expect(anchorOf(events, 'H1')?.elapsed).toBe(0);
  });

  it('a voided Start is no anchor', () => {
    expect(anchorOf([clockEvent(true, at('H1', 0), T0, { standing: false })], 'H1')).toBeNull();
  });

  it('a clock event stamped in another period is not this period’s anchor', () => {
    const events = [clockEvent(true, at('H2', 0), T0), clockEvent(true, at('H1', 50), T0 + SECOND)];
    expect(anchorOf(events, 'H2')?.elapsed).toBe(0);
  });

  it('an unstamped clock event projects the one before, with its own flag, time and base', () => {
    const events = [
      clockEvent(true, at('H1', 100), T0),
      clockEvent(false, null, T0 + 65_500, { base: 'device' }),
    ];
    // 100 s, then 65.5 s on the clock, floored: 165, stopped from the Pause's own arrival.
    expect(anchorOf(events, 'H1')).toEqual({
      period: 'H1',
      elapsed: 165,
      running: false,
      atMs: T0 + 65_500,
      base: 'device',
    });
  });

  it('an unstamped Start after a Pause keeps the paused reading', () => {
    const events = [clockEvent(false, at('H1', 100), T0), clockEvent(true, null, T0 + 40 * SECOND)];
    expect(anchorOf(events, 'H1')).toEqual({
      period: 'H1',
      elapsed: 100,
      running: true,
      atMs: T0 + 40 * SECOND,
      base: 'server',
    });
  });

  it('a clock event with no running flag says nothing', () => {
    const garbled: AnchorEvent = {
      ...clockEvent(true, at('H1', 50), T0 + SECOND),
      payload: { at: at('H1', 50) },
    };
    expect(anchorOf([clockEvent(true, at('H1', 0), T0), garbled], 'H1')?.elapsed).toBe(0);
  });

  it('an unstamped clock event with no anchor before it is skipped', () => {
    expect(anchorOf([clockEvent(true, null, T0)], 'H1')).toBeNull();
  });

  it('a phone’s own stand-in is device-based, its server copy and a console’s are server-based', () => {
    const event = {
      id: 'ev-1',
      seq: 1,
      type: 'football.clock',
      payload: { running: true },
      recordedAt: '2026-11-07T12:00:00.000Z',
      voids: null,
    };
    expect(anchorBase({ ...event, deviceLinkId: null }, ['ev-1'])).toBe('device');
    expect(anchorBase({ ...event, deviceLinkId: PHONE_LINK }, ['ev-1'])).toBe('server');
    expect(anchorBase({ ...event, deviceLinkId: null }, [])).toBe('server');
  });
});

describe('match time (ruling 108, 109)', () => {
  it('H2 at 600 s reads 55:00', () => {
    expect(clockText(matchTime(at('H2', 600), cfgOf(LEAGUE_11)))).toBe('55:00');
  });

  it('H2 at 2850 s reads 90+2:30 on the clock and 90+3′ as a minute', () => {
    const t = matchTime(at('H2', 2850), cfgOf(LEAGUE_11));
    expect(clockText(t)).toBe('90+2:30');
    expect(minuteText(t)).toBe("90+3'");
  });

  it('H2 at 2880 s reads 90+3:00 on the clock and 90+4′', () => {
    const t = matchTime(at('H2', 2880), cfgOf(LEAGUE_11));
    expect(clockText(t)).toBe('90+3:00');
    expect(minuteText(t)).toBe("90+4'");
  });

  it('H1 at 2700 s reads 45:00 and 45+1′', () => {
    const t = matchTime(at('H1', 2700), cfgOf(LEAGUE_11));
    expect(clockText(t)).toBe('45:00');
    expect(minuteText(t)).toBe("45+1'");
  });

  it('a minute is the one being played: 41′ at 40:10, 1′ at kick-off', () => {
    expect(minuteText(matchTime(at('H1', 2410), cfgOf(LEAGUE_11)))).toBe("41'");
    expect(minuteText(matchTime(at('H1', 0), cfgOf(LEAGUE_11)))).toBe("1'");
    expect(minuteText(matchTime(at('H1', 2699), cfgOf(LEAGUE_11)))).toBe("45'");
  });

  it('Q3 at 0 reads 20:00', () => {
    expect(clockText(matchTime(at('Q3', 0), cfgOf(MINI)))).toBe('20:00');
  });

  it('ET_H2 at 0 reads 105:00', () => {
    expect(clockText(matchTime(at('ET_H2', 0), cfgOf(KO_11)))).toBe('105:00');
  });

  it('unequal periodSeconds puts H2’s start at 40:00', () => {
    const cfg = cfgOf({ periodSeconds: { H1: 2400, H2: 3000 } });
    expect(clockText(matchTime(at('H2', 0), cfg))).toBe('40:00');
    expect(periodLengths(cfg)).toEqual({ H1: 2400, H2: 3000 });
  });

  it('uniform periodSeconds is ignored', () => {
    expect(periodLengths(cfgOf({ periodSeconds: { H1: 2400, H2: 2400 } }))).toEqual({
      H1: 2700,
      H2: 2700,
    });
  });

  it('a period that ends mid-minute ends at the minute begun, floored (ruling X-11)', () => {
    const cfg = cfgOf({ periodSeconds: { H1: 2430, H2: 2700 } });
    expect(clockText(matchTime(at('H1', 2440), cfg))).toBe('40+0:10');
    expect(minuteText(matchTime(at('H1', 2440), cfg))).toBe("40+1'");
  });

  it('a lone override applies to its own period', () => {
    expect(periodLengths(cfgOf({ periodSeconds: { H2: 3000 } }))).toEqual({ H1: 2700, H2: 3000 });
  });

  it('the periods a cfg reaches: quarters, and extra time only when on', () => {
    expect(periodLengths(cfgOf(MINI))).toEqual({ H1: 600, Q2: 600, Q3: 600, Q4: 600 });
    expect(periodLengths(cfgOf(KO_11))).toEqual({ H1: 2700, H2: 2700, ET_H1: 900, ET_H2: 900 });
  });

  it('an unknown period never reads added time', () => {
    expect(minuteText(matchTime(at('ET_H1', 7000), DEFAULTS))).toBe("117'");
  });
});

/**
 * The web's vector table, row for row (ruling X-11; W Task 4 as built). `{}` is the engine's defaults (2 × 45, no extra
 * time); a row's cfg is those defaults with its fields set.
 */
const WEB_VECTORS: readonly {
  readonly cfg: unknown;
  readonly cases: readonly (readonly [period: string, elapsed: number, reads: string])[];
}[] = [
  {
    cfg: {},
    cases: [
      ['H1', 0, '0:00'],
      ['H1', 65, '1:05'],
      ['H1', 2699, '44:59'],
    ],
  },
  {
    cfg: {},
    cases: [
      ['H1', 2700, '45:00'],
      ['H1', 2759, '45+0:59'],
      ['H1', 2760, '45+1:00'],
    ],
  },
  {
    cfg: {},
    cases: [
      ['H2', 0, '45:00'],
      ['H2', 1320, '67:00'],
      ['H2', 2699, '89:59'],
    ],
  },
  {
    cfg: {},
    cases: [
      ['H2', 2850, '90+2:30'],
      ['H2', 2880, '90+3:00'],
      ['H2', 3360, '90+11:00'],
    ],
  },
  {
    cfg: { extraTime: { enabled: true, halfMinutes: 15 } },
    cases: [
      ['ET_H1', 0, '90:00'],
      ['ET_H1', 900, '105:00'],
      ['ET_H2', 0, '105:00'],
      ['ET_H2', 905, '120+0:05'],
    ],
  },
  {
    cfg: { halves: 4, halfMinutes: 10 },
    cases: [
      ['H1', 0, '0:00'],
      ['Q2', 0, '10:00'],
      ['Q3', 125, '22:05'],
      ['Q4', 660, '40+1:00'],
    ],
  },
  {
    cfg: { periodSeconds: { H1: 2400, H2: 2700 } },
    cases: [
      ['H1', 2430, '40+0:30'],
      ['H2', 0, '40:00'],
    ],
  },
  { cfg: { periodSeconds: { H1: 2400, H2: 2400 } }, cases: [['H2', 0, '45:00']] },
  { cfg: {}, cases: [['ET_H1', 65, '1:05']] },
  {
    cfg: {},
    cases: [
      ['H1', -5, '0:00'],
      ['H1', Number.NaN, '0:00'],
    ],
  },
];

describe("the web's vector table (ruling X-11)", () => {
  it.each(WEB_VECTORS.map((row, i) => [i + 1, row] as const))('row %i', (_row, { cfg, cases }) => {
    for (const [period, elapsed, reads] of cases) {
      expect(clockText(matchTime({ period, elapsed }, cfgOf(cfg))), `${period} ${elapsed}`).toBe(
        reads,
      );
    }
  });
});

describe('stamping (design §7.3)', () => {
  it('the phase order is the engine’s play phases between the whistle and the kicks', () => {
    expect(PHASE_ORDER).toEqual([
      'pre',
      'H1',
      'H2',
      'Q2',
      'Q3',
      'Q4',
      'ET_H1',
      'ET_H2',
      'SHOOTOUT',
    ]);
  });

  it('a clock that knows no time stamps nothing', () => {
    expect(stampFor(null, 'H1', at('H1', 600))).toBeNull();
  });

  it('stampFor raises to a same-period asOf', () => {
    expect(stampFor(at('H1', 590), 'H1', at('H1', 600))).toEqual(at('H1', 600));
    expect(stampFor(at('H1', 610), 'H1', at('H1', 600))).toEqual(at('H1', 610));
  });

  it('stampFor ignores an asOf in an earlier period', () => {
    expect(stampFor(at('H2', 30), 'H2', at('H1', 2700))).toEqual(at('H2', 30));
    expect(stampFor(at('H2', 30), 'H2', null)).toEqual(at('H2', 30));
  });

  it('a stamp captured in another period than the fold’s is dropped', () => {
    expect(stampFor(at('H1', 2690), 'H2', at('H1', 2700))).toBeNull();
  });

  it('subStamp is asOf in the same phase and null otherwise', () => {
    expect(subStamp('H2', at('H2', 600))).toEqual(at('H2', 600));
    expect(subStamp('H2', at('H1', 2700))).toBeNull();
    expect(subStamp('H2', null)).toBeNull();
  });

  it('newestStamp is the last stamp in stream order', () => {
    const events = [
      { type: 'football.goal', payload: { by: 'x', at: at('H1', 100) } },
      { type: 'football.card', payload: { by: 'x', color: 'yellow', at: at('H1', 300) } },
      { type: 'football.goal', payload: { by: 'x' } },
      { type: 'core.start', payload: {} },
    ];
    expect(newestStamp(events)).toEqual(at('H1', 300));
    expect(newestStamp([])).toBeNull();
    expect(newestStamp([{ type: 'football.goal', payload: { at: { period: 'H1' } } }])).toBeNull();
  });
});

describe('restamp (design §7.3, ruling 3)', () => {
  const goal = (stamp?: { period: string; elapsed: number }) =>
    stamp === undefined ? { by: 'ent-home' } : { by: 'ent-home', at: stamp };

  it('restamp raises a same-period stamp', () => {
    expect(restamp('football.goal', goal(at('H1', 590)), at('H1', 600), 'H1')).toEqual(
      goal(at('H1', 600)),
    );
  });

  it('keeps a same-period stamp at or above the floor', () => {
    const payload = goal(at('H1', 600));
    expect(restamp('football.goal', payload, at('H1', 600), 'H1')).toBe(payload);
  });

  it('drops an earlier-period stamp', () => {
    expect(restamp('football.goal', goal(at('H1', 2690)), at('H1', 2700), 'H2')).toEqual(goal());
  });

  it('drops a stamp in a period the phase has left, with no floor', () => {
    expect(restamp('football.goal', goal(at('H1', 100)), null, 'H2')).toEqual(goal());
  });

  it('keeps a later one', () => {
    const payload = goal(at('H2', 30));
    expect(restamp('football.goal', payload, at('H1', 2700), 'H2')).toBe(payload);
  });

  it('leaves a stamp in a later period than the fold’s, a sub’s included (ruling 3: otherwise as is)', () => {
    const later = goal(at('H2', 30));
    expect(restamp('football.goal', later, at('H1', 2700), 'H1')).toBe(later);
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 30) };
    expect(restamp('football.sub', sub, at('H1', 2700), 'H1')).toBe(sub);
  });

  it('sets a sub to the floor', () => {
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 600) };
    expect(restamp('football.sub', sub, at('H2', 640), 'H2')).toEqual({
      ...sub,
      at: at('H2', 640),
    });
  });

  it('drops a sub’s stamp when the floor is in another period', () => {
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 600) };
    const { at: _dropped, ...unstamped } = sub;
    expect(restamp('football.sub', sub, at('H1', 2700), 'H2')).toEqual(unstamped);
  });

  it('leaves a payload with no at', () => {
    const payload = goal();
    expect(restamp('football.goal', payload, at('H1', 600), 'H1')).toBe(payload);
  });

  it('leaves a stamp with no floor in the phase', () => {
    const payload = goal(at('H1', 10));
    expect(restamp('football.goal', payload, null, 'H1')).toBe(payload);
  });

  it('leaves a period it does not know', () => {
    const payload = goal(at('Q9', 10));
    expect(restamp('football.goal', payload, at('H1', 600), 'H1')).toBe(payload);
  });
});

// The controller's ruling of 2026-11-08 (design §7.2 at 8aafcca2): a Start accepted 3 s or more after it was tapped is
// followed by one more clock event, running at the phone's reading then, so every screen re-anchors on a stamp that is
// true at its arrival. The Start's own payload is never changed.
describe('the resync after a late Start (design §7.2)', () => {
  const TAPPED = Date.parse('2026-11-07T14:30:00.000Z');
  const start = { createdAtMs: TAPPED, running: true, period: 'H1' };

  it('not when the Start is accepted 2999 ms after it was tapped', () => {
    expect(needsResync(start, TAPPED + 2999, false)).toBe(false);
  });

  it('when the Start is accepted 3000 ms after it was tapped', () => {
    expect(needsResync(start, TAPPED + 3000, false)).toBe(true);
  });

  it('when the Start is accepted 120 s after it was tapped (the owner’s "server down for 2 mins")', () => {
    expect(needsResync(start, TAPPED + 120_000, false)).toBe(true);
  });

  it('never for a Pause, however late: a stopped reading is true whenever it arrives', () => {
    expect(needsResync({ ...start, running: false }, TAPPED + 120_000, false)).toBe(false);
  });

  it('never when a later clock event stands: it re-anchored every screen already', () => {
    expect(needsResync(start, TAPPED + 120_000, true)).toBe(false);
  });

  it('never for an answer timed before the tap (the phone’s clock was set back)', () => {
    expect(needsResync(start, TAPPED - 60_000, false)).toBe(false);
  });

  it('the resync tap is a running clock tap at the phone’s reading at that moment', () => {
    const own: ClockAnchor = {
      period: 'H1',
      elapsed: 600,
      running: true,
      atMs: TAPPED,
      base: 'device',
    };
    const accepted = { deviceMs: TAPPED + 120_000, offsetMs: 300_000 };
    expect(resyncTap(own, accepted)).toEqual({ kind: 'clock', running: true, elapsed: 720 });
  });

  it('the resync tap reads a server anchor through the offset, as the screen does', () => {
    const copy: ClockAnchor = {
      period: 'H1',
      elapsed: 600,
      running: true,
      atMs: TAPPED,
      base: 'server',
    };
    // The server's clock is 5 s ahead of the phone's: 120 s on the phone's clock is 125 s on the server's.
    const accepted = { deviceMs: TAPPED + 120_000, offsetMs: 5_000 };
    expect(resyncTap(copy, accepted)).toEqual({ kind: 'clock', running: true, elapsed: 725 });
  });
});
