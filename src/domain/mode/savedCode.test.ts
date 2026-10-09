import { describe, expect, it } from 'vitest';
import {
  decodeMode,
  decodeSavedCode,
  encodeSavedCode,
  isExpired,
  savedCodeFrom,
  venueZone,
  type SavedCode,
} from '@/domain/mode/savedCode';
import { sampleWaiting, SAMPLE_CODE } from '@/services/fakeCodePort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_NOW, FIXTURE_TOKEN } from '../../../test/fixtures/wire';

const LATER = new Date('2026-10-03T15:00:00Z');
const CODE_URL = `https://stg.seazn.club/api/v1/capture/codes/${SAMPLE_CODE}`;

/** The waiting fields as the server and the store write them: epoch seconds, by hand. */
const waitingWire = (overrides: Record<string, unknown> = {}) => ({
  code: SAMPLE_CODE,
  label: 'Seazn XI v Fake CC',
  venueTimezone: 'Europe/London',
  scheduledStart: 1790003600,
  autoAllowed: true,
  destinationName: 'YouTube · Fake CC',
  pollSeconds: 60,
  heartbeatUrl: `${CODE_URL}/beats`,
  startUrl: `${CODE_URL}/start`,
  ...overrides,
});

/** A stored record written by hand, with one field changed. `undefined` drops the field. */
function record(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    v: 3,
    mode: 'stream',
    raw: 'r',
    slot: 0,
    savedAt: 1,
    expiresAt: null,
    stream: { waiting: waitingWire(), codeUrl: CODE_URL, tapToPair: false },
    ...overrides,
  });
}

const streamCode = (token: string, expiresAt: Date | null) =>
  ({ mode: 'stream', raw: 'r', code: SAMPLE_CODE, slot: 0, token, expiresAt }) as const;

describe('saved codes, v3 (amendment §3)', () => {
  it.each([false, true])('round-trips a stream code with its stream part, tapToPair %s', (tap) => {
    const code = savedStreamCode({
      stream: {
        waiting: sampleWaiting({ scheduledStart: new Date(1790003600_000) }),
        codeUrl: CODE_URL,
        tapToPair: tap,
      },
    });
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  // P6: a stream record keeps its waiting fields at `stream.waiting` (savedCode.ts encodeSavedCode), so that is where
  // a code saved before D2 still names its overlay.
  it('reads a code saved before D2, whose waiting fields still name an overlay (D2 §4.1)', () => {
    const code = savedStreamCode({
      stream: { waiting: sampleWaiting(), codeUrl: CODE_URL, tapToPair: false },
    });
    const saved = encodeSavedCode(code);
    const old = JSON.parse(saved) as { stream: { waiting: Record<string, unknown> } };
    const withOverlay = JSON.stringify({
      ...old,
      stream: {
        ...old.stream,
        waiting: {
          ...old.stream.waiting,
          overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
        },
      },
    });
    const read = decodeSavedCode(withOverlay);
    expect(read).toEqual(code);
    expect(read?.stream?.waiting && 'overlayUrl' in read.stream.waiting).toBe(false);
  });

  it('round-trips a scoring code, which has no stream part', () => {
    const code: SavedCode = {
      mode: 'scoring',
      raw: 'https://stg.seazn.club/score/abc',
      slot: null,
      savedAt: FIXTURE_NOW,
      expiresAt: null,
      stream: null,
    };
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  it('reads a record written by hand, not only its own round trip', () => {
    expect(decodeSavedCode(record({}))).toEqual({
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: new Date(1),
      expiresAt: null,
      stream: {
        waiting: {
          ...waitingWire(),
          scheduledStart: new Date(1790003600_000),
          // A record written before the stage existed has no such key: it reads as none.
          stage: null,
        },
        codeUrl: CODE_URL,
        tapToPair: false,
      },
    });
  });

  // W28: the round line is kept with the code, kind and all, so a cold-start re-pair seeds it.
  it('keeps a stage through encode and decode, and reads a record saved before this change with none', () => {
    const stage = { label: 'Open · QF', kind: 'quarter_final' };
    const code = savedStreamCode({
      stream: { waiting: sampleWaiting({ stage }), codeUrl: CODE_URL, tapToPair: false },
    });
    const back = decodeSavedCode(encodeSavedCode(code));
    expect(back?.stream?.waiting.stage).toEqual(stage);
    expect(back).toEqual(code);
    // The stored record holds the stage in the server's own shape, which the one parser reads back.
    expect(JSON.parse(encodeSavedCode(code)).stream.waiting.stage).toEqual({
      role: { kind: 'quarter_final' },
      label: 'Open · QF',
    });
    // A record with no `stage` key at all, as every record saved before this PR is.
    expect(decodeSavedCode(record({}))?.stream?.waiting.stage).toBeNull();
    // A stored stage of a kind the contract does not name reads as none, and the code is kept.
    const future = record({
      stream: {
        waiting: waitingWire({ stage: { role: { kind: 'a_future_kind' }, label: 'Open · QF' } }),
        codeUrl: CODE_URL,
        tapToPair: false,
      },
    });
    expect(decodeSavedCode(future)?.stream?.waiting.stage).toBeNull();
  });

  it('drops a v1 record: clean slate, never migrated', () => {
    const v1 = JSON.stringify({
      v: 1,
      mode: 'stream',
      raw: 'r',
      slot: 1,
      savedAt: 1,
      expiresAt: 2,
      venueTz: null,
    });
    expect(decodeSavedCode(v1)).toBeNull();
  });

  it('drops a v2 record, which held the session and its credentials', () => {
    const v2 = JSON.stringify({
      v: 2,
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: 1,
      expiresAt: null,
      descriptor: { sid: 's' },
    });
    expect(decodeSavedCode(v2)).toBeNull();
    // The version alone drops it: this one carries a stream part that would read.
    expect(decodeSavedCode(record({ v: 2 }))).toBeNull();
  });

  it('drops a stream record with no stream part', () => {
    expect(decodeSavedCode(encodeSavedCode(savedStreamCode({ stream: null })))).toBeNull();
    expect(decodeSavedCode(record({ stream: undefined }))).toBeNull();
  });

  it("drops a stream part whose beat URL is off the code URL's host", () => {
    const foreign = waitingWire({ heartbeatUrl: 'https://evil.example/beats' });
    expect(
      decodeSavedCode(
        record({ stream: { waiting: foreign, codeUrl: CODE_URL, tapToPair: false } }),
      ),
    ).toBeNull();
  });

  it.each([
    ['no codeUrl', { waiting: waitingWire(), tapToPair: false }],
    ['a string tapToPair', { waiting: waitingWire(), codeUrl: CODE_URL, tapToPair: 'no' }],
    ['no waiting fields', { codeUrl: CODE_URL, tapToPair: false }],
    [
      'an http codeUrl',
      { waiting: waitingWire(), codeUrl: 'http://stg.seazn.club/x', tapToPair: false },
    ],
    ['a stream part that is not an object', 'waiting'],
  ])('drops a stream part with %s', (_label, stream) => {
    expect(decodeSavedCode(record({ stream }))).toBeNull();
  });

  it('keeps the stream part handed over at save', () => {
    const stream = { waiting: sampleWaiting(), codeUrl: CODE_URL, tapToPair: false };
    const code = savedCodeFrom(streamCode('t', FIXTURE_NOW), FIXTURE_NOW, stream);
    expect(code.stream).toBe(stream);
  });

  it('never stores the token, which lives only in raw', () => {
    const stream = { waiting: sampleWaiting(), codeUrl: CODE_URL, tapToPair: false };
    const code = savedCodeFrom(streamCode(FIXTURE_TOKEN, LATER), FIXTURE_NOW, stream);
    expect(encodeSavedCode(code)).not.toContain(FIXTURE_TOKEN);
  });

  it('builds a saved code from a recognised one; a scoring code saves no stream part', () => {
    expect(savedCodeFrom(streamCode('t', LATER), FIXTURE_NOW, null)).toEqual({
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: FIXTURE_NOW,
      expiresAt: LATER,
      stream: null,
    });
    const stream = { waiting: sampleWaiting(), codeUrl: CODE_URL, tapToPair: false };
    const fromScoring = savedCodeFrom(
      { mode: 'scoring', raw: 'u', token: 't' },
      FIXTURE_NOW,
      stream,
    );
    expect([fromScoring.expiresAt, fromScoring.slot, fromScoring.stream]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('keeps a code with no exp unexpiring', () => {
    expect(savedCodeFrom(streamCode('t', null), FIXTURE_NOW, null).expiresAt).toBeNull();
  });

  it('reads the venue zone from the waiting fields, else none', () => {
    expect(venueZone(savedStreamCode())).toBe('Europe/London');
    expect(venueZone(savedStreamCode({ stream: null }))).toBeNull();
  });

  it.each([
    ['not JSON', 'nope'],
    ['a future version', record({ v: 4 })],
    ['a v1 record carrying a stream part', record({ v: 1 })],
    ['an unknown mode', record({ mode: 'chat' })],
    ['a missing raw', record({ raw: undefined })],
    ['a string time', record({ savedAt: 'yesterday' })],
    ['a fractional slot', record({ slot: 1.5 })],
    ['a negative slot', record({ slot: -1 })],
    ['a stream part that is not an object', record({ stream: 'waiting' })],
  ])('refuses %s', (_label, text) => {
    expect(decodeSavedCode(text)).toBeNull();
  });

  it('decodes only known modes', () => {
    expect(decodeMode('stream')).toBe('stream');
    expect(decodeMode('chat')).toBeNull();
    expect(decodeMode(null)).toBeNull();
  });

  it('expires at the exact instant, and never without an expiry', () => {
    const saved = savedStreamCode({ savedAt: FIXTURE_NOW, expiresAt: LATER });
    expect(isExpired(saved, LATER)).toBe(true);
    expect(isExpired(saved, FIXTURE_NOW)).toBe(false);
    expect(isExpired({ ...saved, expiresAt: null }, LATER)).toBe(false);
  });
});
