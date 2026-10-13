import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { createLogger } from '@/services/logger';
import { createRecordSendFlight } from '@/services/recordSendFlight';
import { createRecordUploadPort, type PostFetch } from '@/services/recordUploadPort';
import { createRingRecord, createRoutedRecord, type RingRecord } from '@/services/sessionRecord';
import { createFakeUploadCredential } from '../../test/fakePorts';

/**
 * N38 (the controller's ruling, 2026-10-12; the D3 fixes ledger): Send record posts the newest 1,000 lines, and the web
 * files a line with no sid only inside a pairing window, which opens at the pairing's `pair` line (the contract's A2).
 * On R-MA1P the ring had let the `pair` and `broadcast-start` lines go, and every line was dropped. The ring pins the
 * latest `pair` and, while its window is open, the latest `broadcast-start` with a sid, outside its capacity, until the
 * line that ended the window has left the ring (the controller's amendment, 2026-10-13); the send puts them first. The
 * record is not localised, so the fourth question's language does not apply; its modes and orientations reach the ring
 * only as lines, which these cases are.
 */

/** Native's lines as `Pairings.kt` writes them, made up (AGENTS §13): the tag, sids and code belong to nothing. */
const at = (n: number) => new Date(Date.UTC(2026, 9, 12, 21, 0, 0) + n * 100).toISOString();
const PAIR = `{"at":"${at(0)}","kind":"pair","claim":"new","slot":0,"tokenTag":"c980ff38","stopped":false}`;
const PAIR_2 = `{"at":"${at(1)}","kind":"pair","claim":"new","slot":1,"tokenTag":"0d15ea5e","stopped":false}`;
/** The contract's own `line-valid` sid, and a second of the same shape. */
const SID = '5f2c8a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b';
const SID_2 = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';
const startWith = (sid: unknown) =>
  JSON.stringify({ at: at(2), kind: 'broadcast-start', sid, cause: 'organiser' });
const START = startWith(SID);
const START_2 = startWith(SID_2);
const lineOf = (kind: string, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ at: at(3), kind, ...fields });
/** What an operator's Stop writes (`SessionMachine.end`, then the reset back to Idle). */
const ENDED = lineOf('ended', { reason: 'operator-stopped', wasLive: true });
const FINAL_BEAT = lineOf('final-beat', { result: 'answered', status: 200 });
const RESET = lineOf('reset');
/** `count` lines with no sid, each its own (`sent` numbers them), as a beat would be. */
const beats = (count: number, tag = 'b') =>
  Array.from({ length: count }, (_, n) => lineOf('beats', { sent: n, field: tag }));

function ringOf(lines: readonly string[], capacity?: number): RingRecord {
  const ring = createRingRecord(capacity);
  for (const line of lines) ring.appendLine(line);
  return ring;
}

describe('N38: Send record keeps the pairing’s pair and broadcast-start lines', () => {
  it('a ring that let the pair, its start and 2,000 more go sends those two first, then the newest 998', () => {
    const b = beats(3_000);
    const ring = ringOf([PAIR, START, ...b]);
    const sent = ring.linesToSend(1_000);
    expect(sent).toEqual([PAIR, START, ...b.slice(-998)]);
    expect(new Set(sent).size).toBe(1_000);
    // Diagnostics shows the ring, not the pins, and the ring keeps its capacity.
    expect(ring.lines()).toEqual(b.slice(-1_000));
  });

  // The controller's amendment to the N38 ruling (2026-10-13, Batch 18 fix round 1): Send is off air only and the
  // token outlives the pairing by 24 h (R4), so a send follows the end of the window. The web's window runs through the
  // line that ended it, so the pins stay until that line has left the ring.
  it('R-MA1P’s sequence, a Send just after a Stop ten minutes on air: the pair and its start still lead', () => {
    const live = beats(1_500);
    const ring = ringOf([PAIR, lineOf('paired'), START, ...live, ENDED, FINAL_BEAT, RESET]);
    // The ring holds live[503..], then the three; the pair and the start go first, and live[503] and [504] give way.
    expect(ring.linesToSend(1_000)).toEqual([
      PAIR,
      START,
      ...live.slice(505),
      ENDED,
      FINAL_BEAT,
      RESET,
    ]);
  });

  // The contract's A2 (recordContract.test.ts reads these four from its description).
  it.each(['unpaired', 'ended', 'pair-refused', 'reset'])(
    'a %s still in the ring keeps both pins, and goes in the body with them',
    (kind) => {
      const before = beats(1_500);
      const after = beats(10, 'c');
      const ring = ringOf([PAIR, START, ...before, lineOf(kind), ...after]);
      expect(ring.linesToSend(1_000)).toEqual([
        PAIR,
        START,
        ...before.slice(513),
        lineOf(kind),
        ...after,
      ]);
    },
  );

  it.each(['unpaired', 'ended', 'pair-refused', 'reset'])(
    'once 1,000 lines follow a %s, it has left the ring: the pins go, and the send is the newest 1,000 alone',
    (kind) => {
      const after = beats(1_000, 'c');
      const gone = ringOf([PAIR, START, ...beats(1_500), lineOf(kind), ...after]);
      expect(gone.linesToSend(1_000)).toEqual(after);
      // One line sooner it is the ring's oldest: still in the ring, so the pins stand and it goes with them.
      const oldest = ringOf([PAIR, START, ...beats(1_500), lineOf(kind), ...after.slice(1)]);
      expect(oldest.linesToSend(1_000)).toEqual([PAIR, START, lineOf(kind), ...after.slice(3)]);
    },
  );

  it('the window ends at its first closing line: a later one holds nothing once the first has gone', () => {
    const after = beats(999);
    expect(ringOf([PAIR, START, ENDED, ...after, RESET]).linesToSend(1_000)).toEqual([
      ...after,
      RESET,
    ]);
  });

  it('a broadcast-start after the window ended pins nothing, and the window’s own start stays', () => {
    const before = beats(1_500);
    const after = beats(10, 'c');
    const ring = ringOf([PAIR, START, ...before, ENDED, START_2, ...after]);
    expect(ring.linesToSend(1_000)).toEqual([
      PAIR,
      START,
      ...before.slice(514),
      ENDED,
      START_2,
      ...after,
    ]);
  });

  it('a new pair after the window ended replaces both pins at once', () => {
    const after = beats(1_500, 'c');
    const ring = ringOf([PAIR, START, ...beats(1_500), ENDED, RESET, PAIR_2, ...after]);
    expect(ring.linesToSend(1_000)).toEqual([PAIR_2, ...after.slice(-999)]);
    // The new pair still in the ring: nothing is let go, so the body is the ring as it is.
    const soon = ringOf([
      PAIR,
      START,
      ...beats(1_500),
      ENDED,
      RESET,
      PAIR_2,
      ...after.slice(0, 10),
    ]);
    expect(soon.linesToSend(1_000)).toEqual(soon.lines());
  });

  // A re-scan: native ends the old pairing with `unpaired {reason: "re-pair"}` (PairingTest.kt), then writes the pair.
  it('unpaired for a re-pair, then the new pair and its start: the new pairing leads', () => {
    const after = beats(3_000, 'c');
    const repair = lineOf('unpaired', { reason: 're-pair' });
    const ring = ringOf([PAIR, START, ...beats(1_500), repair, PAIR_2, START_2, ...after]);
    expect(ring.linesToSend(1_000)).toEqual([PAIR_2, START_2, ...after.slice(-998)]);
  });

  // a6cc1f038: engine-error closes nothing (native writes one where the pairing goes on), and a broadcast's end is not
  // the pairing's.
  it('engine-error and broadcast-ended end nothing: both pins stand', () => {
    const b = beats(3_000);
    const ring = ringOf([PAIR, START, lineOf('engine-error'), lineOf('broadcast-ended'), ...b]);
    expect(ring.linesToSend(1_000)).toEqual([PAIR, START, ...b.slice(-998)]);
  });

  it('a second pair replaces the first, and lets the first pairing’s broadcast-start go', () => {
    const b = beats(3_000);
    expect(ringOf([PAIR, START, PAIR_2, ...b]).linesToSend(1_000)).toEqual([
      PAIR_2,
      ...b.slice(-999),
    ]);
    expect(ringOf([PAIR, START, PAIR_2, START_2, ...b]).linesToSend(1_000)).toEqual([
      PAIR_2,
      START_2,
      ...b.slice(-998),
    ]);
  });

  it('a later broadcast-start replaces the earlier', () => {
    const b = beats(3_000);
    expect(ringOf([PAIR, START, START_2, ...b]).linesToSend(1_000)).toEqual([
      PAIR,
      START_2,
      ...b.slice(-998),
    ]);
  });

  // The contract's `sid`: a uuid is judged by A1; a mask, null, absent or any other shape names no session.
  it.each([
    ['absent', undefined],
    ['null', null],
    ['masked', '***'],
    ['not a uuid', 'sess_42'],
    ['a number', 42],
    ['a uuid in a list', [SID_2]],
  ])('a broadcast-start whose sid is %s pins nothing, and keeps the earlier', (_name, sid) => {
    const b = beats(3_000);
    expect(ringOf([PAIR, START, startWith(sid), ...b]).linesToSend(1_000)).toEqual([
      PAIR,
      START,
      ...b.slice(-998),
    ]);
    expect(ringOf([PAIR, startWith(sid), ...b]).linesToSend(1_000)).toEqual([
      PAIR,
      ...b.slice(-999),
    ]);
  });

  it('a broadcast-start with no pair standing pins nothing', () => {
    const b = beats(3_000);
    expect(ringOf([START, ...b]).linesToSend(1_000)).toEqual(b.slice(-1_000));
  });

  it('fewer than 1,000 lines: the ring as it is, in order, each pin once in its place', () => {
    const lines = [lineOf('paired'), PAIR, ...beats(5), START, ...beats(5, 'c')];
    const ring = ringOf(lines);
    expect(ring.linesToSend(1_000)).toEqual(lines);
    // 1,000 exactly: nothing let go, so nothing moves.
    const full = [PAIR, START, ...beats(998)];
    expect(ringOf(full).linesToSend(1_000)).toEqual(full);
  });

  it('a pin still in the ring goes once, in its place, and the oldest lines not pinned give way', () => {
    // 1,001 lines: the pair is let go and the start is the ring's oldest.
    const b = beats(999);
    expect(ringOf([PAIR, START, ...b]).linesToSend(1_000)).toEqual([PAIR, START, ...b.slice(1)]);
    // The start in the middle: the ring holds b[101..], the start, then c; b[101] gives way to the pair.
    const early = beats(500);
    const late = beats(600, 'c');
    expect(ringOf([PAIR, ...early, START, ...late]).linesToSend(1_000)).toEqual([
      PAIR,
      ...early.slice(102),
      START,
      ...late,
    ]);
  });

  // A phone that ran a while before this pairing: the ring is full when the pair comes, so a pin's place counts every
  // line the ring was given, not its index in the ring.
  it('a ring already full when the pair comes: pins still in it go once, in place; let go, they go first', () => {
    const before = beats(1_500, 'a');
    const between = beats(10, 'd');
    const after = beats(600, 'c');
    const ring = ringOf([...before, PAIR, ...between, START, ...after]);
    expect(ring.linesToSend(1_000)).toEqual(ring.lines());
    expect(ring.linesToSend(1_000)).toEqual([
      ...before.slice(-388),
      PAIR,
      ...between,
      START,
      ...after,
    ]);
    const later = beats(1_200, 'e');
    for (const line of later) ring.appendLine(line);
    expect(ring.linesToSend(1_000)).toEqual([PAIR, START, ...later.slice(-998)]);
  });

  it('pins outside a smaller ring’s capacity, and keeps to the size it is asked for', () => {
    const ring = ringOf([PAIR, START, lineOf('a'), lineOf('b'), lineOf('c')], 3);
    expect(ring.lines()).toEqual([lineOf('a'), lineOf('b'), lineOf('c')]);
    expect(ring.linesToSend(1_000)).toEqual([PAIR, START, lineOf('a'), lineOf('b'), lineOf('c')]);
    expect(ring.linesToSend(4)).toEqual([PAIR, START, lineOf('b'), lineOf('c')]);
  });

  it('asked twice, it answers the same lines, and leaves the ring as it was (a second call)', () => {
    const ring = ringOf([PAIR, START, ...beats(3_000)]);
    const before = ring.lines();
    const first = ring.linesToSend(1_000);
    expect(ring.linesToSend(1_000)).toEqual(first);
    expect(ring.lines()).toBe(before);
  });

  it('an empty ring sends nothing, and a ring with no pair sends its newest 1,000 (an empty input)', () => {
    expect(createRingRecord().linesToSend(1_000)).toEqual([]);
    const ring = ringOf(beats(1_200));
    expect(ring.linesToSend(1_000)).toEqual(ring.lines());
  });

  // Each is read for its kind alone: none is a `pair` line, none throws, and none opens a window.
  it.each([
    'not json',
    '{"kind":"pair"',
    'null',
    '42',
    '"pair"',
    '["pair"]',
    '{"kind":["pair"]}',
    '{"kind":"pair-step-late"}',
    '{"at":"2026-10-12T21:00:00.000Z","kind":"intent-ignored","intent":"pair"}',
  ])('%s is never pinned and never throws (an empty input)', (unreadable) => {
    const b = beats(3_000);
    const ring = createRingRecord();
    expect(() => ring.appendLine(unreadable)).not.toThrow();
    for (const line of b) ring.appendLine(line);
    expect(ring.linesToSend(1_000)).toEqual(b.slice(-1_000));
  });

  it('an unreadable line among them never breaks the pins (after an interruption)', () => {
    const b = beats(3_000);
    const ring = ringOf([PAIR, 'not json', START, '{"kind":', 'null', ...b]);
    expect(ring.linesToSend(1_000)).toEqual([PAIR, START, ...b.slice(-998)]);
  });

  it('native’s lines, through the routed record, are pinned as the ring’s (CD7)', () => {
    const ring = createRingRecord();
    const record = createRoutedRecord(ring, { active: () => true, forward: () => undefined });
    const b = beats(3_000);
    for (const line of [PAIR, START, ...b]) ring.appendLine(line);
    expect(record.linesToSend(1_000)).toEqual([PAIR, START, ...b.slice(-998)]);
  });
});

/**
 * Acceptance 7 of Batch 18: the body Send record posts, through the flight and the real port, is the vendored
 * contract's line for line, and every line in it files under the pairing. A2 is walked here as the contract's
 * description words it; A1 (a uuid sid's session) is the server's to judge, so a line with a sid is not counted here.
 */
type Schema = { readonly $id: string; readonly description: string };
const contract = JSON.parse(
  readFileSync(new URL('../../contracts/capture-record.v1.json', import.meta.url), 'utf8'),
) as Schema;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(contract);
const validate = ajv.getSchema(contract.$id);
const admitsLine = (value: unknown) => validate?.(value) === true;
/** The kinds A2's window "runs through the next" of, read from the description as recordContract.test.ts reads them. */
const CLOSING = [
  ...(
    /runs through the next ((?:`[a-z-]+`(?:, | or )?)+) line/.exec(contract.description)?.[1] ?? ''
  ).matchAll(/`([a-z-]+)`/g),
].map(([, kind]) => kind);

/** The lines with no sid that fall in no window: a window opens at `pair` and ends at a closing or refused line. */
function unfiled(body: readonly string[]): number {
  let open = false;
  let outside = 0;
  for (const text of body) {
    const line = JSON.parse(text) as Record<string, unknown>;
    if (!admitsLine(line)) open = false;
    else if (line.kind === 'pair') open = true;
    else {
      if ((line.sid ?? null) === null && !open) outside += 1;
      if (CLOSING.includes(String(line.kind))) open = false;
    }
  }
  return outside;
}

/** Made up (AGENTS §13): a code URL of the QR's shape on the staging host, and a token, that belong to nothing. */
const CREDENTIAL: UploadCredential = {
  codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn',
  token: 'AAAAAAAAAAAAAAAAAAAAAA',
  expiresAtMs: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('N38: the body posted is the contract’s, and files under its pairing', () => {
  /** A match's worth of native lines: beats with no sid, the broadcast's own with one, a warning now and then. */
  const match = (count: number) =>
    Array.from({ length: count }, (_, n) =>
      n % 10 === 0
        ? lineOf('live', { sid: SID, transport: 'srt' })
        : n % 7 === 0
          ? lineOf('thermal', { level: 'warn', status: 2, headroom: 0.5 })
          : lineOf('beats', { sent: n, late: 0 }),
    );

  async function posted(ring: RingRecord): Promise<string[]> {
    const fetch = vi.fn<PostFetch>(async () => ({
      status: 201,
      json: async () => ({ ref: 'R-7K2Q' }),
    }));
    const upload = createRecordUploadPort({
      fetch,
      logger: createLogger({ record: createRingRecord(), now: () => 0 }),
      host: 'stg.seazn.club',
    });
    const credentials = createFakeUploadCredential(CREDENTIAL);
    const flight = createRecordSendFlight({ credentials, upload, record: ring });
    flight.send();
    await vi.advanceTimersByTimeAsync(10);
    expect(flight.getSnapshot().state).toEqual({ kind: 'sent', ref: 'R-7K2Q' });
    return String(fetch.mock.calls[0]?.[1]?.body).trim().split('\n');
  }

  it('the pinned body: 1,000 lines the contract admits, the pins first, every line with no sid filed', async () => {
    const lines = match(3_000);
    const body = await posted(ringOf([PAIR, START, ...lines]));
    expect(body).toEqual([PAIR, START, ...lines.slice(-998)]);
    expect(body.filter((line) => !admitsLine(JSON.parse(line)))).toEqual([]);
    expect(unfiled(body)).toBe(0);
  });

  // Anti-vacuity: the judge sees R-MA1P's failure, the newest 1,000 with the pair let go.
  it('without the pins, the lines with no sid would file under nothing', () => {
    const lines = match(3_000).slice(-1_000);
    expect(lines.filter((line) => !admitsLine(JSON.parse(line)))).toEqual([]);
    expect(unfiled(lines)).toBeGreaterThan(800);
    expect(unfiled([PAIR, ...lines])).toBe(0);
    expect(CLOSING).toEqual(['unpaired', 'ended', 'pair-refused', 'reset']);
  });

  // The reviewer's probe of Batch 18, as a test: before the amendment this body had no pair and 901 lines unfiled.
  it('R-MA1P’s sequence through the port: the pins lead, and only the two lines after ended are unfiled', async () => {
    const lines = match(1_500);
    const ended = [ENDED, FINAL_BEAT, RESET];
    const body = await posted(ringOf([PAIR, lineOf('paired'), START, ...lines, ...ended]));
    expect(body).toEqual([PAIR, START, ...lines.slice(505), ...ended]);
    expect(body.filter((line) => !admitsLine(JSON.parse(line)))).toEqual([]);
    // final-beat and reset come after the window's end: the web files neither, pins or no pins.
    expect(unfiled(body)).toBe(2);
    expect(unfiled(body.slice(2))).toBeGreaterThan(800);
  });

  it('once 1,000 lines follow the end, the body is the newest 1,000 alone', async () => {
    const lines = match(1_000);
    const body = await posted(ringOf([PAIR, START, ...match(1_500), ENDED, ...lines]));
    expect(body).toEqual(lines);
  });
});
