import { describe, expect, it } from 'vitest';
import {
  CODE_STATES,
  parseWaitingFields,
  STAGE_KINDS,
  waitingToWire,
} from '@/domain/credentials/waitingFields';

// Made up, inside capture-descriptor.v1's waiting branch (web 5bb72e8a2): a 12-character code and
// the D3 paths. The fixtures ruling replaces the plan's `fx-42`.
const HOST = 'stg.seazn.club';
const fields = (overrides: Record<string, unknown> = {}) => ({
  code: 'fx42hmnp7k2q',
  label: 'Example Town v Sample CC',
  venueTimezone: 'Europe/London',
  scheduledStart: 1_790_003_600,
  autoAllowed: true,
  destinationName: 'YouTube · Example Town CC',
  pollSeconds: 60,
  heartbeatUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
  startUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
  ...overrides,
});

describe('the waiting fields at the scan', () => {
  it('reads them from a session-shaped answer and never keeps cred (round 5, A1)', () => {
    const session = fields({
      state: 'live',
      sid: '6f1c2b7a-3d4e-4f50-8a9b-0c1d2e3f4a5b',
      cred: {
        srt: null,
        rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'fake-key-0000' },
      },
    });
    const read = parseWaitingFields(session, HOST);
    expect(read).not.toBeNull();
    expect(Object.keys(read ?? {}).sort()).toEqual([
      'autoAllowed',
      'code',
      'court',
      'destinationName',
      'heartbeatUrl',
      'label',
      'pollSeconds',
      'scheduledStart',
      'stage',
      'startUrl',
      'venueTimezone',
    ]);
    expect(JSON.stringify(read)).not.toContain('fake-key-0000');
  });

  it('trusts nothing on a build with no host', () => {
    expect(parseWaitingFields(fields(), '')).toBeNull();
  });

  it('refuses what is not an object', () => {
    expect(parseWaitingFields(null, HOST)).toBeNull();
    expect(parseWaitingFields('waiting', HOST)).toBeNull();
    expect(parseWaitingFields([fields()], HOST)).toBeNull();
  });

  it('refuses a code outside the code alphabet, as the schema does (carry G1)', () => {
    expect(parseWaitingFields(fields({ code: 'fx-42' }), HOST)).toBeNull();
    expect(parseWaitingFields(fields({ code: 'FX42HMNP7K2Q' }), HOST)).toBeNull();
  });

  it('refuses a start URL off the build host whole, as the beat URL is (its Bearer would go there)', () => {
    expect(parseWaitingFields(fields({ startUrl: 'https://evil.example/s' }), HOST)).toBeNull();
    expect(parseWaitingFields(fields({ startUrl: 'http://stg.seazn.club/s' }), HOST)).toBeNull();
  });

  it('refuses a scheduled start a date cannot hold, never an Invalid Date', () => {
    const read = parseWaitingFields(fields({ scheduledStart: 9_007_199_254_740_991 }), HOST);
    expect(read).toBeNull();
  });

  it('round-trips through its own wire, so a saved code reads back the same', () => {
    const read = parseWaitingFields(fields(), HOST);
    if (read === null) throw new Error('the fixture must parse');
    expect(waitingToWire(read)).toEqual(fields());
    expect(parseWaitingFields(waitingToWire(read), HOST)).toEqual(read);
  });

  it('round-trips a code with no scheduled start, and none is kept as null', () => {
    const read = parseWaitingFields(fields({ scheduledStart: undefined }), HOST);
    if (read === null) throw new Error('the fixture must parse');
    expect(read.scheduledStart).toBeNull();
    expect(waitingToWire(read)).toMatchObject({ scheduledStart: null });
    expect(parseWaitingFields(waitingToWire(read), HOST)).toEqual(read);
  });

  it('names every state a 200 may carry, waiting and session-shaped (capture-descriptor.v1)', () => {
    expect(CODE_STATES).toEqual(['waiting', 'warming', 'live', 'ending', 'completed', 'failed']);
  });
});

const STAGE = (over: Record<string, unknown> = {}) => ({
  code: 'QF',
  role: { kind: 'quarter_final' },
  label: 'Open · QF',
  ...over,
});

describe('the stage at the scan (spec §2, R-F20)', () => {
  it('reads the label of a stage with a known kind, and keeps the kind with it', () => {
    expect(parseWaitingFields(fields({ stage: STAGE() }), HOST)?.stage).toEqual({
      label: 'Open · QF',
      kind: 'quarter_final',
    });
  });

  it.each([
    ['a label of 41 characters', STAGE({ label: 'x'.repeat(41) })],
    ['an empty label', STAGE({ label: '' })],
    ['no label', { code: 'QF', role: { kind: 'quarter_final' } }],
    ['null', null],
    ['not an object', 'QF'],
    ['an unknown kind with a good label (R-F20)', STAGE({ role: { kind: 'a_future_kind' } })],
    ['no role', { code: 'QF', label: 'Open · QF' }],
    ['a kind that is not a string', STAGE({ role: { kind: 7 } })],
  ])('%s is no stage, and the rest of the answer is still read', (_why, stage) => {
    const read = parseWaitingFields(fields({ stage }), HOST);
    expect(read).not.toBeNull();
    expect(read?.stage).toBeNull();
    expect(read?.label).toBe('Example Town v Sample CC');
  });

  it('reads no stage when the answer has none', () => {
    expect(parseWaitingFields(fields(), HOST)?.stage).toBeNull();
  });

  it('shows the label for each of the 15 kinds the contract names', () => {
    let shown = 0;
    for (const kind of STAGE_KINDS) {
      expect(
        parseWaitingFields(fields({ stage: STAGE({ role: { kind } }) }), HOST)?.stage?.label,
      ).toBe('Open · QF');
      shown += 1;
    }
    expect(shown).toBe(15);
  });

  it('round-trips a stage through the saved wire, kind and all, and a saved code from before this change reads none', () => {
    const read = parseWaitingFields(fields({ stage: STAGE() }), HOST);
    if (read === null) throw new Error('the fixture must parse');
    expect(waitingToWire(read)).toMatchObject({
      stage: { role: { kind: 'quarter_final' }, label: 'Open · QF' },
    });
    expect(parseWaitingFields(waitingToWire(read), HOST)).toEqual(read);
    // Without a stage the wire carries no `stage` key at all, so older saved codes and new ones agree.
    const none = parseWaitingFields(fields(), HOST);
    if (none === null) throw new Error('the fixture must parse');
    expect(Object.keys(waitingToWire(none))).not.toContain('stage');
  });
});

describe('the court at the scan (court stream spec 2026-11-14 §6.1)', () => {
  it("reads a court code's court name, and none on a fixture's code", () => {
    expect(parseWaitingFields(fields({ court: { name: 'Court 2' } }), HOST)?.court).toBe('Court 2');
    expect(parseWaitingFields(fields(), HOST)?.court).toBeNull();
    expect(parseWaitingFields(fields({ court: null }), HOST)?.court).toBeNull();
  });

  // A malformed court is never no court: a fixture-style Stop on a court phone would unlink the court (spec §3).
  it.each([
    ['an empty name', { name: '' }],
    ['a name of 81 characters', { name: 'x'.repeat(81) }],
    ['a name that is not a string', { name: 2 }],
    ['no name', {}],
    ['a string, not an object', 'Court 2'],
    ['an array', [{ name: 'Court 2' }]],
    ['a number', 2],
  ])('refuses the whole answer for a court with %s', (_why, court) => {
    expect(parseWaitingFields(fields({ court }), HOST)).toBeNull();
  });

  // Readers ignore what they do not use (the QR's tampered.json, D-2): an extra key in court is still a court.
  it('reads a court with a key the phone does not use, never as no court', () => {
    expect(parseWaitingFields(fields({ court: { name: 'Court 2', id: 'c2' } }), HOST)?.court).toBe(
      'Court 2',
    );
  });

  it('reads the same court twice from the same answer', () => {
    const body = fields({ court: { name: 'Court 2' } });
    expect(parseWaitingFields(body, HOST)).toEqual(parseWaitingFields(body, HOST));
  });

  it('round-trips a court through the saved wire, and a saved code from before this change reads none', () => {
    const read = parseWaitingFields(fields({ court: { name: 'Court 2' } }), HOST);
    if (read === null) throw new Error('the fixture must parse');
    expect(waitingToWire(read)).toMatchObject({ court: { name: 'Court 2' } });
    const back = parseWaitingFields(waitingToWire(read), HOST);
    expect(back?.court).toBe('Court 2');
    expect(back).toEqual(read);
    // A fixture's code saves no `court` key at all, so a code saved before this build and a new one agree.
    const none = parseWaitingFields(fields(), HOST);
    if (none === null) throw new Error('the fixture must parse');
    expect(Object.keys(waitingToWire(none))).not.toContain('court');
    expect(parseWaitingFields(waitingToWire(none), HOST)?.court).toBeNull();
  });
});

// E2 (2026-11-17): a court's refused automatic start rides the waiting answer, the descriptor's too. It is native's to
// show, from each answer as it comes: the scan neither refuses the answer for it nor saves it, so a re-pair after a
// process death never shows a refusal the server has since cleared.
describe('a refused automatic start at the scan', () => {
  it.each([
    ['a known word', 'destination_in_use'],
    ['an unknown word', 'nope'],
    ['a null', null],
    ['a number', 5],
  ])('reads the answer with %s and saves none of it', (_why, autoRefusal) => {
    const read = parseWaitingFields(fields({ court: { name: 'Court 2' }, autoRefusal }), HOST);
    if (read === null) throw new Error('the answer must parse');
    expect(read.court).toBe('Court 2');
    expect(read).toEqual(parseWaitingFields(fields({ court: { name: 'Court 2' } }), HOST));
    expect(Object.keys(waitingToWire(read))).not.toContain('autoRefusal');
  });
});
