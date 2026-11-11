import { football, type FootballCfg } from '@seazn/engine/sports/football';
import { describe, expect, it } from 'vitest';
import {
  anchorBase,
  anchorOf,
  clockText,
  correctionsIn,
  matchTime,
  minuteText,
  needsResync,
  newestStamp,
  PHASE_ORDER,
  periodLengths,
  overtaken,
  periodStarted,
  reading,
  restamp,
  resyncTap,
  stampFor,
  stoppageClosesIn,
  subStampFor,
  subStoppageOf,
  SUB_STOPPAGE_SECONDS,
  type AnchorEvent,
  type ClockAnchor,
} from '@/domain/scoring/footballClock';
import {
  at,
  BROWSER_LINK,
  clock,
  goal,
  KO_11,
  LEAGUE_11,
  ledgerOf,
  MINI,
  period,
  PHONE_LINK,
  queuedOf,
  start,
  voiding,
  type Spec,
} from '../../../test/footballLedger';

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

// The controller's ruling 154: a sub joins the stoppage when the newest stamped event in the period is itself a sub and the
// sub's own reading is no more than 120 s past that event's stamp; it then takes that exact stamp (one window).
describe('a substitution’s stamp (ruling 154)', () => {
  const subAt = (stamp: { period: string; elapsed: number }, type = 'football.sub') => ({
    type,
    payload: { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: stamp },
  });
  const goalAt = (stamp: { period: string; elapsed: number }) => ({
    type: 'football.goal',
    payload: { by: 'ent-away', at: stamp },
  });

  it('the stoppage is 120 s', () => {
    expect(SUB_STOPPAGE_SECONDS).toBe(120);
  });

  it('120 s past the stoppage joins it, taking its exact stamp; 121 s does not, and takes its own reading', () => {
    const stoppage = at('H2', 600);
    expect(subStampFor(at('H2', 720), 'H2', stoppage, stoppage)).toEqual(at('H2', 600));
    expect(subStampFor(at('H2', 721), 'H2', stoppage, stoppage)).toEqual(at('H2', 721));
  });

  it('the stoppage is the newest stamped event when it is a sub, of either team, a concussion replacement included', () => {
    expect(subStoppageOf([goalAt(at('H1', 100)), subAt(at('H1', 600))], 'H1')).toEqual(
      at('H1', 600),
    );
    const theirs = { ...subAt(at('H1', 600)), payload: { by: 'ent-away', at: at('H1', 600) } };
    expect(subStoppageOf([theirs], 'H1')).toEqual(at('H1', 600));
    expect(subStoppageOf([subAt(at('H1', 600), 'core.lineup.replacement')], 'H1')).toEqual(
      at('H1', 600),
    );
    // An unstamped event after it (the start, a kick) is no stamped event: it does not end the stoppage.
    expect(
      subStoppageOf([subAt(at('H1', 600)), { type: 'core.start', payload: {} }], 'H1'),
    ).toEqual(at('H1', 600));
  });

  it('a goal, a card or a clock event after the last sub ends the stoppage', () => {
    expect(subStoppageOf([subAt(at('H1', 600)), goalAt(at('H1', 610))], 'H1')).toBeNull();
    const card = {
      type: 'football.card',
      payload: { by: 'ent-home', color: 'yellow', at: at('H1', 610) },
    };
    expect(subStoppageOf([subAt(at('H1', 600)), card], 'H1')).toBeNull();
    const pause = { type: 'football.clock', payload: { running: false, at: at('H1', 610) } };
    expect(subStoppageOf([subAt(at('H1', 600)), pause], 'H1')).toBeNull();
  });

  it('a sub in another period than the phase is no stoppage, and nothing stamped is none', () => {
    expect(subStoppageOf([subAt(at('H1', 2700))], 'H2')).toBeNull();
    expect(subStoppageOf([], 'H1')).toBeNull();
  });

  it('a chain does not creep: the 120 s run from the shared stamp, not from the sub before', () => {
    const stoppage = at('H1', 600);
    // Two subs at 600 and 690 share 600; a third at 780 is 180 s past 600, so it takes its own reading.
    expect(subStampFor(at('H1', 690), 'H1', stoppage, stoppage)).toEqual(stoppage);
    expect(subStampFor(at('H1', 780), 'H1', stoppage, stoppage)).toEqual(at('H1', 780));
  });

  it('with no stoppage a sub takes its own reading, raised to the floor; with no reading or in a break, none', () => {
    expect(subStampFor(at('H1', 900), 'H1', at('H1', 600), null)).toEqual(at('H1', 900));
    expect(subStampFor(at('H1', 590), 'H1', at('H1', 600), null)).toEqual(at('H1', 600));
    expect(subStampFor(null, 'H1', at('H1', 600), at('H1', 600))).toBeNull();
    // At half-time the engine is in H2 and its clock has no anchor: the reading is none, and so is the stamp.
    expect(subStampFor(null, 'H2', at('H1', 2700), null)).toBeNull();
  });

  it('a stoppage in another period than the reading is not joined', () => {
    expect(subStampFor(at('H2', 30), 'H2', at('H1', 2700), at('H1', 2700))).toEqual(at('H2', 30));
  });

  it('the stoppage closes 121 s past its stamp: the seconds left from a reading, none once closed', () => {
    expect(stoppageClosesIn(at('H1', 600), 600)).toBe(121);
    expect(stoppageClosesIn(at('H1', 600), 720)).toBe(1);
    expect(stoppageClosesIn(at('H1', 600), 721)).toBeNull();
    expect(stoppageClosesIn(null, 600)).toBeNull();
  });
});

describe('restamp (design §7.3, ruling 3)', () => {
  const goal = (stamp?: { period: string; elapsed: number }) =>
    stamp === undefined ? { by: 'ent-home' } : { by: 'ent-home', at: stamp };

  it('restamp raises a same-period stamp', () => {
    expect(restamp('football.goal', goal(at('H1', 590)), at('H1', 600), 'H1', null)).toEqual(
      goal(at('H1', 600)),
    );
  });

  it('keeps a same-period stamp at or above the floor', () => {
    const payload = goal(at('H1', 600));
    expect(restamp('football.goal', payload, at('H1', 600), 'H1', null)).toBe(payload);
  });

  it('drops an earlier-period stamp', () => {
    expect(restamp('football.goal', goal(at('H1', 2690)), at('H1', 2700), 'H2', null)).toEqual(
      goal(),
    );
  });

  it('drops a stamp in a period the phase has left, with no floor', () => {
    expect(restamp('football.goal', goal(at('H1', 100)), null, 'H2', null)).toEqual(goal());
  });

  it('keeps a later one', () => {
    const payload = goal(at('H2', 30));
    expect(restamp('football.goal', payload, at('H1', 2700), 'H2', null)).toBe(payload);
  });

  it('leaves a stamp in a later period than the fold’s, a sub’s included (ruling 3: otherwise as is)', () => {
    const later = goal(at('H2', 30));
    expect(restamp('football.goal', later, at('H1', 2700), 'H1', null)).toBe(later);
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 30) };
    expect(restamp('football.sub', sub, at('H1', 2700), 'H1', null)).toBe(sub);
  });

  it('a sub below the floor with no stoppage is raised to the floor, as any tap', () => {
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 600) };
    expect(restamp('football.sub', sub, at('H2', 640), 'H2', null)).toEqual({
      ...sub,
      at: at('H2', 640),
    });
  });

  it('a sub keeps its own stamp when the floor is in an earlier period (ruling 154: no longer dropped)', () => {
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 600) };
    expect(restamp('football.sub', sub, at('H1', 2700), 'H2', null)).toBe(sub);
  });

  it('a sub queued offline joins another phone’s sub that landed first within 120 s, and not past it', () => {
    const sub = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 700) };
    const theirs = at('H2', 590);
    expect(restamp('football.sub', sub, theirs, 'H2', theirs)).toEqual({ ...sub, at: theirs });
    const late = { ...sub, at: at('H2', 711) };
    expect(restamp('football.sub', late, theirs, 'H2', theirs)).toBe(late);
  });

  // Review M1: a joined sub keeps its own reading in the queue; the send falls back to it when the stoppage is gone.
  it('a joined sub whose stoppage is gone goes at its own reading; with the stoppage standing it stays joined', () => {
    const joined = { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: at('H2', 600) };
    const own = at('H2', 700);
    expect(restamp('football.sub', joined, at('H2', 0), 'H2', null, own)).toEqual({
      ...joined,
      at: own,
    });
    expect(restamp('football.sub', joined, null, 'H2', null, own)).toEqual({ ...joined, at: own });
    const stoppage = at('H2', 600);
    expect(restamp('football.sub', joined, stoppage, 'H2', stoppage, own)).toBe(joined);
    // A later stamp standing above the reading raises it, as any tap.
    expect(restamp('football.sub', joined, at('H2', 710), 'H2', null, own)).toEqual({
      ...joined,
      at: at('H2', 710),
    });
    // A reading in a period the phase has left is dropped with the stamp.
    expect(restamp('football.sub', joined, at('H2', 2700), 'ET_H1', null, own)).toEqual({
      by: 'ent-home',
      off: 'H-p8',
      on: 'H-p14',
    });
  });

  it('a concussion replacement follows the same rule', () => {
    const replacement = {
      side: 'ent-home',
      off: 'H-p8',
      on: { personId: 'H-p14', slot: 'bench', orderNo: 1 },
      exemption: 'concussion',
      at: at('H2', 650),
    };
    const stoppage = at('H2', 600);
    expect(restamp('core.lineup.replacement', replacement, stoppage, 'H2', stoppage)).toEqual({
      ...replacement,
      at: stoppage,
    });
  });

  it('leaves a payload with no at', () => {
    const payload = goal();
    expect(restamp('football.goal', payload, at('H1', 600), 'H1', null)).toBe(payload);
  });

  it('leaves a stamp with no floor in the phase', () => {
    const payload = goal(at('H1', 10));
    expect(restamp('football.goal', payload, null, 'H1', null)).toBe(payload);
  });

  it('leaves a period it does not know', () => {
    const payload = goal(at('Q9', 10));
    expect(restamp('football.goal', payload, at('H1', 600), 'H1', null)).toBe(payload);
  });
});

// The controller's ruling of 2026-11-08 (design §7.2 at 8aafcca2): a Start accepted 3 s or more after it was tapped is
// followed by one more clock event, running at the phone's reading then, so every screen re-anchors on a stamp that is
// true at its arrival. The Start's own payload is never changed.
describe('the resync after a late Start (design §7.2)', () => {
  const TAPPED = Date.parse('2026-11-07T14:30:00.000Z');
  const start = { createdAtMs: TAPPED, running: true, period: 'H1', elapsed: 600 };

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

  it('the resync tap is the Start’s own stamp plus the whole seconds it waited until it left the queue', () => {
    expect(resyncTap(start, TAPPED + 120_000)).toEqual({
      kind: 'clock',
      running: true,
      elapsed: 720,
    });
    expect(resyncTap(start, TAPPED + 120_999)).toEqual({
      kind: 'clock',
      running: true,
      elapsed: 720,
    });
  });

  // The probe of the controller's ruling 2 (N1): a Start tapped at 0:00, written at the server 60 s later and its copy
  // read back 63 s after the tap. The display's anchor is then the copy's, recorded at its arrival, and reads 3; the
  // resync is built from the Start's own tap and reads 63.
  it('the probe: the server’s copy fetched reads 3, and the resync built from the Start’s own tap reads 63', () => {
    const kickOff = { createdAtMs: TAPPED, running: true, period: 'H1', elapsed: 0 };
    const copy: ClockAnchor = {
      period: 'H1',
      elapsed: 0,
      running: true,
      atMs: TAPPED + 60_000,
      base: 'server',
    };
    const leftAt = TAPPED + 63_000;
    expect(reading(copy, { deviceMs: leftAt, offsetMs: 0 })).toBe(3);
    expect(resyncTap(kickOff, leftAt)).toEqual({ kind: 'clock', running: true, elapsed: 63 });
  });

  it('a phone clock set back before the tap waits no time: the resync is the Start’s own stamp', () => {
    expect(resyncTap(start, TAPPED - 60_000)).toEqual({
      kind: 'clock',
      running: true,
      elapsed: 600,
    });
  });
});

// The controller's fix-round ruling I1 (2026-11-08, superseding ruling 9): a running clock event that follows a running
// one in the same period, with no Pause and no period marker between, is a clock correction, whoever sent it and
// whenever it was recorded. So is a stopped one after a stopped one (a Correct while paused). Times play no part.
describe('which clock events are corrections (ruling I1)', () => {
  const T = Date.parse('2026-11-07T14:30:00.000Z');
  const at600 = { period: 'H1', elapsed: 600 };

  it('a running clock event after a running Start is a correction, at any stamp and any time', () => {
    const resync = [
      clockEvent(true, at600, T, { base: 'device' }),
      clockEvent(true, { period: 'H1', elapsed: 720 }, T + 120_000, { base: 'device' }),
    ];
    // The server's copies: both recorded on arrival, half a second apart, the second stamped 2 min ahead.
    const copies = [
      clockEvent(true, at600, T + 120_000),
      clockEvent(true, { period: 'H1', elapsed: 720 }, T + 120_500),
    ];
    const plusMinute = [
      clockEvent(true, at600, T),
      clockEvent(true, { period: 'H1', elapsed: 690 }, T + 30_000),
    ];
    const back = [
      clockEvent(true, at600, T),
      clockEvent(true, { period: 'H1', elapsed: 540 }, T + 30_000),
    ];
    expect([...correctionsIn(resync)]).toEqual([1]);
    expect([...correctionsIn(copies)]).toEqual([1]);
    expect([...correctionsIn(plusMinute)]).toEqual([1]);
    expect([...correctionsIn(back)]).toEqual([1]);
  });

  it('a stopped clock event after a stopped one is a correction; a Pause after a Start is not, nor a Start after a Pause', () => {
    const whilePaused = [
      clockEvent(true, at600, T),
      clockEvent(false, { period: 'H1', elapsed: 630 }, T + 30_000),
      clockEvent(false, { period: 'H1', elapsed: 660 }, T + 40_000),
      clockEvent(true, { period: 'H1', elapsed: 660 }, T + 50_000),
    ];
    expect([...correctionsIn(whilePaused)]).toEqual([2]);
  });

  it('every running one after the first is a correction: a second and a third', () => {
    const events = [
      clockEvent(true, at600, T),
      clockEvent(true, { period: 'H1', elapsed: 700 }, T + 60_000),
      clockEvent(true, { period: 'H1', elapsed: 800 }, T + 120_000),
    ];
    expect([...correctionsIn(events)]).toEqual([1, 2]);
  });

  it('an unstamped running clock event after a running one is a correction in its period', () => {
    const events = [clockEvent(true, at600, T), clockEvent(true, null, T + 60_000)];
    expect([...correctionsIn(events)]).toEqual([1]);
  });

  it('the first clock event of a period is no correction: a Start, or a Pause with nothing before it', () => {
    expect([...correctionsIn([clockEvent(true, at600, T)])]).toEqual([]);
    expect([...correctionsIn([clockEvent(false, at600, T)])]).toEqual([]);
    expect([...correctionsIn([])]).toEqual([]);
  });

  it('a period marker ends the anchor: a running clock event after it is no correction, even in the old period', () => {
    const events = [
      clockEvent(true, at600, T),
      marker('HT', T + 61_000),
      clockEvent(true, { period: 'H1', elapsed: 2700 }, T + 120_000),
      clockEvent(true, { period: 'H2', elapsed: 0 }, T + 600_000),
    ];
    expect([...correctionsIn(events)]).toEqual([]);
  });

  it('a period marker ends the anchor for an unstamped Start after it too', () => {
    const events = [
      clockEvent(true, at600, T),
      marker('HT', T + 61_000),
      clockEvent(true, null, T + 120_000),
    ];
    expect([...correctionsIn(events)]).toEqual([]);
  });

  it('a running clock event stamped in another period is no correction, even with no marker between', () => {
    const events = [
      clockEvent(true, at600, T),
      clockEvent(true, { period: 'H2', elapsed: 720 }, T + 120_000),
    ];
    expect([...correctionsIn(events)]).toEqual([]);
  });

  it('a correction undone with its Start is still one: judged against the events as they were made', () => {
    const events = [
      clockEvent(true, at600, T, { standing: false }),
      clockEvent(true, { period: 'H1', elapsed: 720 }, T + 120_000, { standing: false }),
    ];
    expect([...correctionsIn(events)]).toEqual([1]);
  });

  it('a standing event is judged against the standing events: a voided Start before it is passed over', () => {
    const events = [
      clockEvent(false, at600, T - 60_000),
      clockEvent(true, at600, T, { standing: false }),
      clockEvent(true, { period: 'H1', elapsed: 720 }, T + 120_000),
    ];
    expect([...correctionsIn(events)]).toEqual([]);
  });

  it('a voided marker does not end the anchor: a running event after it is still a correction', () => {
    const events = [
      clockEvent(true, at600, T),
      marker('HT', T + 60_000, false),
      clockEvent(true, { period: 'H1', elapsed: 720 }, T + 120_000),
    ];
    expect([...correctionsIn(events)]).toEqual([2]);
  });
});

// The controller's fix-round ruling (e): Correct is offered once the current period's first Start stands.
describe('whether the period’s first Start stands (ruling e)', () => {
  const T = Date.parse('2026-11-07T14:30:00.000Z');
  const kickOff = clockEvent(true, { period: 'H1', elapsed: 0 }, T);

  it('none before any clock event; one once a running clock event stands in the period, and still after a Pause', () => {
    expect(periodStarted([], 'H1')).toBe(false);
    expect(periodStarted([kickOff], 'H1')).toBe(true);
    const paused = clockEvent(false, { period: 'H1', elapsed: 600 }, T + 600_000);
    expect(periodStarted([kickOff, paused], 'H1')).toBe(true);
  });

  it('a period marker ends it: the next period has none until its own Start stands', () => {
    const ht = marker('HT', T + 2_700_000);
    const second = clockEvent(true, { period: 'H2', elapsed: 0 }, T + 3_600_000);
    expect(periodStarted([kickOff, ht], 'H2')).toBe(false);
    expect(periodStarted([kickOff, ht, second], 'H2')).toBe(true);
    expect(periodStarted([kickOff, marker('HT', T + 60_000, false)], 'H1')).toBe(true);
    // The whistle stops its own period's clock too: the half it ended has no Start standing either.
    expect(periodStarted([kickOff, ht], 'H1')).toBe(false);
  });

  it('a voided Start is none, nor a Pause alone, nor a Start stamped in another period', () => {
    expect(
      periodStarted([clockEvent(true, { period: 'H1', elapsed: 0 }, T, { standing: false })], 'H1'),
    ).toBe(false);
    expect(periodStarted([clockEvent(false, { period: 'H1', elapsed: 0 }, T)], 'H1')).toBe(false);
    expect(periodStarted([clockEvent(true, { period: 'H2', elapsed: 0 }, T)], 'H1')).toBe(false);
  });
});

// The controller's ruling, final review (2026-11-08). Kick-off on the browser (seq 1 and 2); the phone, offline, tapped
// Start at 0:00 over that ledger, so its `base` is 2. The phone's link is `link-phone`.
describe('overtaken: another screen’s later clock event in the tap’s period', () => {
  const KICK_OFF: readonly Spec[] = [start(), clock(false, at('H1', 0))];
  const START = { ...queuedOf('k1', clock(true, at('H1', 0))), base: 2 };
  const after = (...more: Spec[]) => ledgerOf([...KICK_OFF, ...more]);

  it('a browser clock event or period marker in H1 above the base overtakes it', () => {
    expect(overtaken(START, after(clock(true, at('H1', 0))), PHONE_LINK, [])).toBe(true);
    expect(overtaken(START, after(clock(false, at('H1', 300))), PHONE_LINK, [])).toBe(true);
    expect(overtaken(START, after(period('HT', at('H1', 2700))), PHONE_LINK, [])).toBe(true);
  });

  it('what the scorer saw when tapping, at or under the base, overtakes nothing', () => {
    expect(overtaken({ ...START, base: 3 }, after(clock(true, at('H1', 0))), PHONE_LINK, [])).toBe(
      false,
    );
  });

  it('this phone’s own events overtake nothing: its link’s, or a stand-in’s with none that it sent', () => {
    const own = (link: string | null): Spec => ({ ...clock(true, at('H1', 0)), link });
    expect(overtaken(START, after(own(PHONE_LINK)), PHONE_LINK, [])).toBe(false);
    // The stand-in is the third event (`ev-3`), and this phone sent it.
    expect(overtaken(START, after(own(null)), PHONE_LINK, ['ev-3'])).toBe(false);
    expect(overtaken(START, after(own(BROWSER_LINK)), PHONE_LINK, [])).toBe(true);
  });

  // The organiser's web console writes `device_link_id` null (web append-event.ts:661), and it is not one this phone sent:
  // it is another screen's, whatever it is (N1 of the final re-review).
  it('the organiser’s console, which has no device link, overtakes it: a clock event or a period marker', () => {
    const console = (spec: Spec): Spec => ({ ...spec, link: null });
    expect(overtaken(START, after(console(clock(true, at('H1', 0)))), PHONE_LINK, [])).toBe(true);
    expect(overtaken(START, after(console(clock(false, at('H1', 300)))), PHONE_LINK, [])).toBe(
      true,
    );
    expect(overtaken(START, after(console(period('HT', at('H1', 2700)))), PHONE_LINK, [])).toBe(
      true,
    );
    // Not when the id is one this phone sent: that is its own stand-in.
    expect(overtaken(START, after(console(clock(true, at('H1', 0)))), PHONE_LINK, ['ev-3'])).toBe(
      false,
    );
  });

  it('a goal, another period, an unstamped clock event or a voided one overtake nothing', () => {
    expect(overtaken(START, after(goal({ by: 'A', at: at('H1', 600) })), PHONE_LINK, [])).toBe(
      false,
    );
    expect(overtaken(START, after(clock(true, at('H2', 0))), PHONE_LINK, [])).toBe(false);
    expect(overtaken(START, after(clock(true)), PHONE_LINK, [])).toBe(false);
    const voided = after(clock(true, at('H1', 0)), voiding('ev-3'));
    expect(overtaken(START, voided, PHONE_LINK, [])).toBe(false);
  });

  it('only a clock tap with a base and a stamp is judged: a goal, an old queue file’s tap, an unstamped one', () => {
    const ledger = after(clock(true, at('H1', 0)));
    const goalTap = { ...queuedOf('k2', goal({ by: 'H', at: at('H1', 0) })), base: 2 };
    expect(overtaken(goalTap, ledger, PHONE_LINK, [])).toBe(false);
    expect(overtaken(queuedOf('k1', clock(true, at('H1', 0))), ledger, PHONE_LINK, [])).toBe(false);
    expect(overtaken({ ...queuedOf('k3', clock(true)), base: 2 }, ledger, PHONE_LINK, [])).toBe(
      false,
    );
    // An unstamped tap has no period, so an unstamped clock event of another screen's is not in it either.
    const unstamped = after(clock(true));
    expect(overtaken({ ...queuedOf('k4', clock(true)), base: 2 }, unstamped, PHONE_LINK, [])).toBe(
      false,
    );
  });
});
