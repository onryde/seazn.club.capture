import { describe, expect, it } from 'vitest';
import { blockedLine, placeOf, refusalMeaning } from '@/domain/matchday/callCopy';
import type { CallReason, CallRefused, Candidate } from '@/domain/matchday/callWire';
import en from '@/i18n/en.json';

const refused = (
  reason: CallReason,
  personName: string | null = null,
  courtName: string | null = null,
): CallRefused => ({ code: 'MD_CALL_REFUSED', reason, personName, courtName });

describe('what a refused Undo says when the desk names a court or a player', () => {
  it.each(['playerBusy', 'courtBusy', 'notCandidateCourt'] as const)(
    '%s on Undo is the match having moved: no placeholder is left unfilled',
    (reason) => {
      expect(refusalMeaning(refused(reason, 'Ann', 'Court 3'), 'undo', 'Court 1')).toEqual({
        key: 'matchday.call.moved',
      });
    },
  );
});

describe('what a refused call says', () => {
  it.each(['MD_UNKNOWN', 'MD_WITHDRAWN', 'MD_ENDED', 'MD_NOT_OPEN'] as const)(
    '%s ends the code: the day’s handling takes over',
    (code) => {
      for (const route of ['candidates', 'preview', 'call', 'undo'] as const) {
        expect(refusalMeaning({ code }, route, 'Court 1')).toBe('leave');
      }
    },
  );

  it('no power says it can’t call', () => {
    expect(refusalMeaning({ code: 'MD_NO_CALL' }, 'call', 'Court 1')).toEqual({
      key: 'matchday.call.noPower',
    });
  });

  it('out of scope names the court on the court’s read and the match everywhere else', () => {
    expect(refusalMeaning({ code: 'MD_OUT_OF_SCOPE' }, 'candidates', 'Court 1')).toEqual({
      key: 'matchday.call.courtOutOfScope',
    });
    for (const route of ['preview', 'call', 'undo'] as const) {
      expect(refusalMeaning({ code: 'MD_OUT_OF_SCOPE' }, route, 'Court 1')).toEqual({
        key: 'matchday.outOfScope',
      });
    }
  });

  it.each([
    ['started', refused('started'), { key: 'matchday.call.started' }],
    ['notCalled', refused('notCalled'), { key: 'matchday.call.moved' }],
    ['notReady', refused('notReady'), { key: 'matchday.call.notReady' }],
    ['frozen', refused('frozen'), { key: 'matchday.call.frozen' }],
    ['notCodeCall', refused('notCodeCall'), { key: 'matchday.call.notCodeCall' }],
    [
      'courtBusy, the court the desk named',
      refused('courtBusy', null, 'Court 4'),
      { key: 'matchday.call.courtBusy', vars: { court: 'Court 4' } },
    ],
    [
      'courtBusy, none named: the sheet’s court',
      refused('courtBusy'),
      { key: 'matchday.call.courtBusy', vars: { court: 'Court 1' } },
    ],
    [
      'notCandidateCourt',
      refused('notCandidateCourt', null, 'Court 5'),
      { key: 'matchday.call.notCandidate', vars: { court: 'Court 5' } },
    ],
    [
      'playerBusy on a court',
      refused('playerBusy', 'Ann Archer', 'Court 3'),
      { key: 'matchday.call.busy', vars: { name: 'Ann Archer', court: 'Court 3' } },
    ],
    [
      'playerBusy on no court',
      refused('playerBusy', 'Ann Archer'),
      { key: 'matchday.call.busyNoCourt', vars: { name: 'Ann Archer' } },
    ],
    ['playerBusy naming nobody', refused('playerBusy'), { key: 'matchday.call.moved' }],
    ['a reason the phone has no word for', refused('unknown'), { key: 'matchday.call.moved' }],
  ])('%s', (_, why, line) => {
    expect(refusalMeaning(why, 'call', 'Court 1')).toEqual(line);
  });

  it('every key it can say is in the dictionary', () => {
    const keys = new Set(Object.keys(en));
    const said = [
      'matchday.call.noPower',
      'matchday.call.courtOutOfScope',
      'matchday.outOfScope',
      'matchday.call.started',
      'matchday.call.moved',
      'matchday.call.courtBusy',
      'matchday.call.notReady',
      'matchday.call.frozen',
      'matchday.call.notCodeCall',
      'matchday.call.notCandidate',
      'matchday.call.busy',
      'matchday.call.busyNoCourt',
    ];
    for (const key of said) expect(keys.has(key)).toBe(true);
  });
});

const candidate = (over: Partial<Candidate>): Candidate =>
  ({
    source: 'thisCourt',
    fromCourtName: null,
    called: false,
    firstInQueue: true,
    blocked: null,
    ...over,
  }) as Candidate;

describe('where a candidate is now', () => {
  it('this court’s own next match is next on the sheet’s court', () => {
    expect(placeOf(candidate({}), 'Court 1')).toEqual({ kind: 'nextOn', court: 'Court 1' });
  });

  it('another court’s is next on that court', () => {
    expect(
      placeOf(candidate({ source: 'otherCourt', fromCourtName: 'Court 2' }), 'Court 1'),
    ).toEqual({ kind: 'nextOn', court: 'Court 2' });
  });

  it('another court’s match already called onto it is called to that court, not next on it', () => {
    expect(
      placeOf(
        candidate({ source: 'otherCourt', fromCourtName: 'Court 2', called: true }),
        'Court 1',
      ),
    ).toEqual({ kind: 'calledTo', court: 'Court 2' });
  });

  it('a later match of another court’s queue is queued on it; this court’s own never is', () => {
    expect(
      placeOf(
        candidate({ source: 'otherCourt', fromCourtName: 'Court 2', firstInQueue: false }),
        'Court 1',
      ),
    ).toEqual({ kind: 'queuedOn', court: 'Court 2' });
    expect(placeOf(candidate({ firstInQueue: false }), 'Court 1')).toEqual({
      kind: 'nextOn',
      court: 'Court 1',
    });
  });

  it('called beats queued', () => {
    expect(
      placeOf(
        candidate({
          source: 'otherCourt',
          fromCourtName: 'Court 2',
          called: true,
          firstInQueue: false,
        }),
        'Court 1',
      ),
    ).toEqual({ kind: 'calledTo', court: 'Court 2' });
  });

  it('another court with no name falls back to the sheet’s court rather than say nothing', () => {
    expect(placeOf(candidate({ source: 'otherCourt' }), 'Court 1')).toEqual({
      kind: 'nextOn',
      court: 'Court 1',
    });
  });

  it('a match on no court is not on a court yet, whatever court it names', () => {
    expect(placeOf(candidate({ source: 'noCourt', fromCourtName: 'Court 9' }), 'Court 1')).toEqual({
      kind: 'noCourt',
    });
  });
});

describe('a blocked candidate’s reason', () => {
  it('is the refusal’s words, and none for an open candidate', () => {
    expect(blockedLine(candidate({}))).toBeNull();
    expect(
      blockedLine(candidate({ blocked: { personName: 'Ann Archer', courtName: 'Court 3' } })),
    ).toEqual({ key: 'matchday.call.busy', vars: { name: 'Ann Archer', court: 'Court 3' } });
    expect(
      blockedLine(candidate({ blocked: { personName: 'Ann Archer', courtName: null } })),
    ).toEqual({ key: 'matchday.call.busyNoCourt', vars: { name: 'Ann Archer' } });
  });
});
