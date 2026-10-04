import { describe, expect, it } from 'vitest';
import { CODE_STATES, parseWaitingFields, waitingToWire } from '@/domain/credentials/waitingFields';

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
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/f1',
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
        rtmps: { url: 'rtmps://live.stg.seazn.club:443/live/', streamKey: 'fake-key-0000' },
      },
    });
    const read = parseWaitingFields(session, HOST);
    expect(read).not.toBeNull();
    expect(Object.keys(read ?? {}).sort()).toEqual([
      'autoAllowed',
      'code',
      'destinationName',
      'heartbeatUrl',
      'label',
      'overlayUrl',
      'pollSeconds',
      'scheduledStart',
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
