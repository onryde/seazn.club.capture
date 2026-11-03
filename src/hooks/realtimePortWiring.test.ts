import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realtimePortFor } from '@/hooks/realtimePortWiring';
import { createLogger } from '@/services/logger';
import type { RealtimeGrant } from '@/services/scoringPort';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

// Made up (AGENTS §13): shaped like the server's grant, belonging to nothing.
const GRANT: RealtimeGrant = {
  token: 'eyJmYWtl.eyJmYWtlLXBheWxvYWQ.ZmFrZS1zaWduYXR1cmU',
  channel: 'fixture:6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10',
  url: 'https://abcdwxyz.supabase.example',
  apikey: 'sb-fake-anon-key-0123456789',
};
const TOPIC = `realtime:${GRANT.channel}`;

/** A Realtime 1.0.0 frame: one JSON object, in both directions. */
type V1Frame = {
  topic: string;
  event: string;
  payload: { access_token: string; config: { private: boolean } };
  ref: string | null;
  join_ref: string | null;
};

/** What the server sends: the same object, as JSON text. */
const serverFrame = (frame: Record<string, unknown>): string => JSON.stringify(frame);

/**
 * The runtime's `WebSocket`, which is all the library is given (Hermes has one: nothing is polyfilled and no `ws` is
 * pulled in). It keeps the frames the library sends, and the test plays the server by `receive`.
 */
class FakeSocket {
  static readonly made: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  bufferedAmount = 0;
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.made.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  get frames(): V1Frame[] {
    return this.sent.map((text) => JSON.parse(text) as V1Frame);
  }
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
};

const handlers = () => ({ onPing: vi.fn(), onDown: vi.fn(), onUp: vi.fn() });

function world() {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  return { port: realtimePortFor({ logger }), record };
}

/** The join frame the library sent, and the server's `ok` to it. */
async function joinedSocket(
  port: ReturnType<typeof world>['port'],
  h: ReturnType<typeof handlers>,
) {
  const off = port.subscribe(GRANT, h);
  await until(() => FakeSocket.made.length > 0 && FakeSocket.made[0].sent.length > 0);
  const socket = FakeSocket.made[0];
  const { join_ref: joinRef, ref, topic, event, payload } = socket.frames[0];
  return { off, socket, joinRef, ref, topic, event, payload };
}

beforeEach(() => {
  FakeSocket.made.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so what it wires is run here, the
 * real `@supabase/realtime-js` over a stand-in for the runtime's `WebSocket`. Every frame is JSON text (`vsn` 1.0.0),
 * so nothing here needs `TextEncoder` or `TextDecoder`. What a device settles is whether Hermes runs the library at
 * all: see the Task 8 report's device check.
 */
describe('the composition root’s Realtime port, over the real library', () => {
  it('opens the runtime’s WebSocket at the grant’s own server, with its key, and joins as a private channel with the token', async () => {
    const { port } = world();
    const { off, socket, topic, event, payload } = await joinedSocket(port, handlers());
    expect(socket.url.startsWith('wss://abcdwxyz.supabase.example/realtime/v1/websocket?')).toBe(
      true,
    );
    expect(new URL(socket.url).searchParams.get('apikey')).toBe(GRANT.apikey);
    expect(new URL(socket.url).searchParams.get('vsn')).toBe('1.0.0');
    expect(topic).toBe(TOPIC);
    expect(event).toBe('phx_join');
    expect(payload.access_token).toBe(GRANT.token);
    expect(payload.config.private).toBe(true);
    off();
  });

  it('a join the server accepts is up, and a state_changed broadcast is a ping', async () => {
    const { port } = world();
    const h = handlers();
    const { off, socket, joinRef, ref } = await joinedSocket(port, h);
    socket.receive(
      serverFrame({
        topic: TOPIC,
        event: 'phx_reply',
        payload: { status: 'ok', response: {} },
        ref,
        join_ref: joinRef,
      }),
    );
    expect(h.onUp).toHaveBeenCalledTimes(1);

    const broadcast = (event: string) =>
      serverFrame({
        topic: TOPIC,
        event: 'broadcast',
        payload: { type: 'broadcast', event, payload: { v: 1, reason: 'event', at: 'now' } },
        ref: null,
        join_ref: null,
      });
    socket.receive(broadcast('state_changed'));
    socket.receive(broadcast('another_event'));
    socket.receive(broadcast('state_changed'));
    expect(h.onPing).toHaveBeenCalledTimes(2);
    expect(h.onPing).toHaveBeenCalledWith();
    off();
  });

  it('a join the server refuses (an expired token) is down, and the line never carries the server’s reason', async () => {
    const { port, record } = world();
    const h = handlers();
    const { off, socket, joinRef, ref } = await joinedSocket(port, h);
    socket.receive(
      serverFrame({
        topic: TOPIC,
        event: 'phx_reply',
        payload: { status: 'error', response: { reason: `Unauthorized ${GRANT.token}` } },
        ref,
        join_ref: joinRef,
      }),
    );
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(h.onUp).not.toHaveBeenCalled();
    const lines = record.lines().map((text) => parseRecordLine(text));
    expect(lines.map((line) => [line.event, line.fields])).toEqual([
      ['scoring.realtime', { state: 'down', status: 'CHANNEL_ERROR' }],
    ]);
    expect(record.lines().join('\n')).not.toContain(GRANT.token);
    off();
  });

  it('unsubscribing closes the socket, and a second subscribe leaves one socket open, not two', async () => {
    const { port } = world();
    const first = await joinedSocket(port, handlers());
    first.off();
    expect(first.socket.closed).toBe(true);

    const a = port.subscribe(GRANT, handlers());
    await until(() => FakeSocket.made.length === 2);
    const b = port.subscribe(GRANT, handlers());
    await until(() => FakeSocket.made.length === 3);
    expect(FakeSocket.made.map((socket) => !socket.closed)).toEqual([false, false, true]);
    a();
    expect(FakeSocket.made[2].closed).toBe(false);
    b();
    expect(FakeSocket.made[2].closed).toBe(true);
  });

  it('a runtime with no WebSocket is down, said, and no socket is made', async () => {
    vi.stubGlobal('WebSocket', undefined);
    const { port, record } = world();
    const h = handlers();
    port.subscribe(GRANT, h);
    await until(() => h.onDown.mock.calls.length > 0);
    expect(FakeSocket.made).toHaveLength(0);
    const lines = record.lines().map((text) => parseRecordLine(text));
    expect(lines.map((line) => [line.event, line.fields])).toEqual([
      ['scoring.realtime', { state: 'down', problem: 'client' }],
    ]);
  });
});
