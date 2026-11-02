import { describe, expect, it, vi } from 'vitest';
import { createLogger, type Logger } from '@/services/logger';
import {
  createSupabaseRealtimePort,
  type RealtimeChannelLike,
  type RealtimeClientFactory,
  type RealtimeClientLike,
} from '@/services/realtimePort';
import type { RealtimeGrant } from '@/services/scoringPort';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

// Made up (AGENTS §13): shaped like the server's grant, belonging to nothing.
const TOKEN = 'eyJmYWtl.eyJmYWtlLXBheWxvYWQ.ZmFrZS1zaWduYXR1cmU';
const APIKEY = 'sb-fake-anon-key-0123456789';
const GRANT: RealtimeGrant = {
  token: TOKEN,
  channel: 'fixture:6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10',
  url: 'https://abcdwxyz.supabase.example',
  apikey: APIKEY,
};
const ENDPOINT = 'wss://abcdwxyz.supabase.example/realtime/v1';

/** What the library's channel does, as far as the port can see it: bindings, and the status callback of `subscribe`. */
class FakeChannel implements RealtimeChannelLike {
  readonly bindings: { type: string; event: string; callback: () => void }[] = [];
  statusCallback: ((status: string) => void) | null = null;
  constructor(
    readonly topic: string,
    readonly params: unknown,
  ) {}
  on(type: 'broadcast', filter: { event: string }, callback: () => void): RealtimeChannelLike {
    this.bindings.push({ type, event: filter.event, callback });
    return this;
  }
  throwsOnSubscribe = false;
  subscribe(callback: (status: string) => void): RealtimeChannelLike {
    this.statusCallback = callback;
    if (this.throwsOnSubscribe) throw new Error('subscribe broke');
    return this;
  }
  /** The server's side: the join answered or the channel lost. */
  status(word: string): void {
    this.statusCallback?.(word);
  }
  /** The server's side: a broadcast reaches every binding of that event, with whatever payload it carried. */
  broadcast(event: string, payload: unknown): void {
    for (const binding of this.bindings) {
      if (binding.event === event) (binding.callback as (p: unknown) => void)(payload);
    }
  }
}

type Behaviour = {
  /** A held `setAuth`: the channel waits for it. */
  gate?: Promise<void>;
  authRejects?: boolean;
  channelThrows?: boolean;
  /** `subscribe` keeps the status callback and then throws, as a library in a bad state can. */
  subscribeThrows?: boolean;
  /** `removeChannel` rejects and `disconnect` throws at once, as a library in a bad state can. */
  closeFails?: boolean;
};

class FakeClient implements RealtimeClientLike {
  /** Every call, in order, by name. */
  readonly steps: string[] = [];
  readonly channels: FakeChannel[] = [];
  readonly removed: unknown[] = [];
  disconnects = 0;
  token: string | null = null;
  constructor(
    readonly endpoint: string,
    readonly options: { params: { apikey: string } },
    private readonly behaviour: Behaviour,
  ) {}
  async setAuth(token: string): Promise<void> {
    this.steps.push('setAuth');
    this.token = token;
    if (this.behaviour.gate !== undefined) await this.behaviour.gate;
    if (this.behaviour.authRejects === true) throw new Error(`refused ${token}`);
  }
  channel(topic: string, params: { config: { private: boolean } }): FakeChannel {
    this.steps.push('channel');
    if (this.behaviour.channelThrows === true) throw new Error(`no channel ${topic}`);
    const channel = new FakeChannel(topic, params);
    channel.throwsOnSubscribe = this.behaviour.subscribeThrows === true;
    this.channels.push(channel);
    return channel;
  }
  async removeChannel(channel: RealtimeChannelLike): Promise<string> {
    this.steps.push('removeChannel');
    this.removed.push(channel);
    if (this.behaviour.closeFails === true) throw new Error(`could not leave ${this.token}`);
    return 'ok';
  }
  disconnect(): Promise<string> {
    this.steps.push('disconnect');
    this.disconnects += 1;
    if (this.behaviour.closeFails === true) throw new Error(`could not close ${this.token}`);
    return Promise.resolve('ok');
  }
  get live(): boolean {
    return this.disconnects === 0;
  }
}

type Line = { level: string; event: string; fields: unknown };

/** A logger that keeps what it was told, whole, so a test can look for what must never be in it. */
function recordingLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const at = (level: string) => (event: string, fields?: unknown) => {
    lines.push({ level, event, fields: fields ?? {} });
  };
  const logger: Logger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    protect: () => undefined,
    protectLink: () => undefined,
    release: () => undefined,
  };
  return { logger, lines };
}

function setup(configure: Behaviour & { createThrows?: boolean } = {}) {
  const clients: FakeClient[] = [];
  const { logger, lines } = recordingLogger();
  const createClient: RealtimeClientFactory = (endpoint, options) => {
    if (configure.createThrows === true) {
      throw new Error(`no WebSocket for ${options.params.apikey}`);
    }
    const client = new FakeClient(endpoint, options, configure);
    clients.push(client);
    return client;
  };
  const port = createSupabaseRealtimePort({ createClient, logger });
  return { port, clients, lines };
}

const handlers = () => ({ onPing: vi.fn(), onDown: vi.fn(), onUp: vi.fn() });
/** The port opens its channel after `setAuth`, which is async: let that settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A subscription through to its channel, ready for the server's side. */
async function joined(grant: RealtimeGrant = GRANT) {
  const world = setup();
  const h = handlers();
  const unsubscribe = world.port.subscribe(grant, h);
  await settle();
  const client = world.clients[0];
  const channel = client.channels[0];
  return { ...world, h, unsubscribe, client, channel };
}

describe('the Realtime port: what it asks the library for', () => {
  it('reaches the grant’s own server over wss, with the grant’s public key', async () => {
    const { clients, port } = setup();
    port.subscribe(GRANT, handlers());
    await settle();
    expect(clients).toHaveLength(1);
    expect(clients[0].endpoint).toBe(ENDPOINT);
    expect(clients[0].options).toEqual({ params: { apikey: APIKEY } });
  });

  it('gives the library the grant’s token before it opens the channel', async () => {
    const { client } = await joined();
    expect(client.token).toBe(TOKEN);
    expect(client.steps.slice(0, 2)).toEqual(['setAuth', 'channel']);
  });

  it('opens the grant’s channel as a private one', async () => {
    const { channel } = await joined();
    expect(channel.topic).toBe(GRANT.channel);
    expect(channel.params).toEqual({ config: { private: true } });
  });

  it('listens for the broadcast named state_changed, and for nothing else', async () => {
    const { channel } = await joined();
    expect(channel.bindings.map(({ type, event }) => ({ type, event }))).toEqual([
      { type: 'broadcast', event: 'state_changed' },
    ]);
    expect(channel.statusCallback).not.toBeNull();
  });

  it('takes the server’s address as an origin: a trailing slash or a path is not copied', async () => {
    const world = setup();
    const first = world.port.subscribe(
      { ...GRANT, url: 'https://abcdwxyz.supabase.example/' },
      handlers(),
    );
    await settle();
    first();
    world.port.subscribe({ ...GRANT, url: 'https://Other.Example:8443/ignored/path' }, handlers());
    await settle();
    expect(world.clients.map((client) => client.endpoint)).toEqual([
      ENDPOINT,
      'wss://other.example:8443/realtime/v1',
    ]);
  });
});

describe('the Realtime port: what it tells the caller', () => {
  it('a state_changed broadcast is a ping, and the caller is told nothing of its payload', async () => {
    const { channel, h } = await joined();
    channel.broadcast('state_changed', { v: 1, reason: 'event', at: 'now', extra: { deep: true } });
    expect(h.onPing).toHaveBeenCalledTimes(1);
    expect(h.onPing).toHaveBeenCalledWith();
  });

  it('a garbled payload is still a ping, and no payload at all too', async () => {
    const { channel, h } = await joined();
    channel.broadcast('state_changed', 'not even an object');
    channel.broadcast('state_changed', null);
    channel.broadcast('state_changed', undefined);
    expect(h.onPing).toHaveBeenCalledTimes(3);
  });

  it('a broadcast of another name is not a ping', async () => {
    const { channel, h } = await joined();
    channel.broadcast('something_else', {});
    expect(h.onPing).not.toHaveBeenCalled();
  });

  it('SUBSCRIBED is up', async () => {
    const { channel, h } = await joined();
    channel.status('SUBSCRIBED');
    expect(h.onUp).toHaveBeenCalledTimes(1);
    expect(h.onDown).not.toHaveBeenCalled();
  });

  it.each(['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT', 'SOMETHING_NEW'])('%s is down', async (word) => {
    const { channel, h } = await joined();
    channel.status(word);
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(h.onUp).not.toHaveBeenCalled();
  });

  it('a channel that never joins is down at the first failure, so that polling starts', async () => {
    const { channel, h } = await joined();
    channel.status('TIMED_OUT');
    channel.status('TIMED_OUT');
    channel.status('CHANNEL_ERROR');
    expect(h.onDown).toHaveBeenCalledTimes(1);
  });

  it('says each change once: the library retries a lost channel, and every retry reports', async () => {
    const { channel, h } = await joined();
    const order: string[] = [];
    h.onUp.mockImplementation(() => order.push('up'));
    h.onDown.mockImplementation(() => order.push('down'));
    for (const word of [
      'SUBSCRIBED',
      'SUBSCRIBED',
      'CHANNEL_ERROR',
      'CLOSED',
      'CHANNEL_ERROR',
      'SUBSCRIBED',
      'TIMED_OUT',
    ]) {
      channel.status(word);
    }
    expect(order).toEqual(['up', 'down', 'up', 'down']);
  });

  it('a ping never changes up or down, and pings keep coming after a drop and a rejoin', async () => {
    const { channel, h } = await joined();
    channel.status('SUBSCRIBED');
    channel.status('CHANNEL_ERROR');
    channel.broadcast('state_changed', {});
    channel.status('SUBSCRIBED');
    channel.broadcast('state_changed', {});
    expect(h.onPing).toHaveBeenCalledTimes(2);
    expect(h.onUp).toHaveBeenCalledTimes(2);
    expect(h.onDown).toHaveBeenCalledTimes(1);
  });

  it('a handler that throws does not reach the library, and the line says so once, without the error’s words', async () => {
    const world = setup();
    const h = handlers();
    h.onPing.mockImplementation(() => {
      throw new Error(`the caller broke on ${TOKEN}`);
    });
    world.port.subscribe(GRANT, h);
    await settle();
    const channel = world.clients[0].channels[0];
    expect(() => channel.broadcast('state_changed', {})).not.toThrow();
    expect(() => channel.broadcast('state_changed', {})).not.toThrow();
    expect(h.onPing).toHaveBeenCalledTimes(2);
    expect(world.lines).toEqual([
      { level: 'warn', event: 'scoring.realtime', fields: { state: 'handler', problem: 'threw' } },
    ]);
    expect(JSON.stringify(world.lines)).not.toContain(TOKEN);
  });
});

describe('the Realtime port: unsubscribing', () => {
  it('removes the channel and disconnects the socket', async () => {
    const { client, channel, unsubscribe } = await joined();
    unsubscribe();
    await settle();
    expect(client.removed).toEqual([channel]);
    expect(client.disconnects).toBe(1);
    expect(client.live).toBe(false);
  });

  it('is heard no more: neither a ping, an up nor a down reaches the caller, and none is said', async () => {
    const { channel, h, lines, unsubscribe } = await joined();
    unsubscribe();
    channel.broadcast('state_changed', {});
    channel.status('SUBSCRIBED');
    channel.status('CLOSED');
    expect(h.onPing).not.toHaveBeenCalled();
    expect(h.onUp).not.toHaveBeenCalled();
    expect(h.onDown).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('a second call changes nothing', async () => {
    const { client, unsubscribe } = await joined();
    unsubscribe();
    unsubscribe();
    await settle();
    expect(client.disconnects).toBe(1);
    expect(client.removed).toHaveLength(1);
  });

  it('a library that fails while closing is said, and never an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const collect = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', collect);
    try {
      const world = setup({ closeFails: true });
      const { unsubscribe } = (() => {
        const off = world.port.subscribe(GRANT, handlers());
        return { unsubscribe: off };
      })();
      await settle();
      expect(() => unsubscribe()).not.toThrow();
      await settle();
      await settle();
      expect(unhandled).toEqual([]);
      expect(world.clients[0].steps.slice(-2)).toEqual(['removeChannel', 'disconnect']);
      expect(world.lines).toEqual([
        {
          level: 'warn',
          event: 'scoring.realtime',
          fields: { state: 'closing', problem: 'close' },
        },
        {
          level: 'warn',
          event: 'scoring.realtime',
          fields: { state: 'closing', problem: 'close' },
        },
      ]);
      expect(JSON.stringify(world.lines)).not.toContain(TOKEN);
    } finally {
      process.off('unhandledRejection', collect);
    }
  });

  it('before the token is accepted, never opens the channel, and still lets the socket go', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = setup({ gate });
    const h = handlers();
    const unsubscribe = world.port.subscribe(GRANT, h);
    unsubscribe();
    release();
    await settle();
    expect(world.clients[0].channels).toHaveLength(0);
    expect(world.clients[0].steps).toEqual(['setAuth', 'disconnect']);
    expect(h.onDown).not.toHaveBeenCalled();
    expect(h.onUp).not.toHaveBeenCalled();
  });
});

describe('the Realtime port: a second call', () => {
  it('a second subscribe closes the first: one socket at a time, never two', async () => {
    const world = setup();
    const first = handlers();
    const second = handlers();
    world.port.subscribe(GRANT, first);
    await settle();
    world.port.subscribe({ ...GRANT, token: `${TOKEN}-fresh` }, second);
    await settle();
    expect(world.clients).toHaveLength(2);
    expect(world.clients.map((client) => client.live)).toEqual([false, true]);
    expect(world.clients[0].removed).toEqual(world.clients[0].channels);
    expect(world.clients[1].token).toBe(`${TOKEN}-fresh`);
  });

  it('the first is heard no more, and the second is', async () => {
    const world = setup();
    const first = handlers();
    const second = handlers();
    world.port.subscribe(GRANT, first);
    await settle();
    world.port.subscribe(GRANT, second);
    await settle();
    const [one, two] = world.clients.map((client) => client.channels[0]);
    one.broadcast('state_changed', {});
    one.status('CLOSED');
    two.broadcast('state_changed', {});
    two.status('SUBSCRIBED');
    expect(first.onPing).not.toHaveBeenCalled();
    expect(first.onDown).not.toHaveBeenCalled();
    expect(second.onPing).toHaveBeenCalledTimes(1);
    expect(second.onUp).toHaveBeenCalledTimes(1);
  });

  it('a second subscribe while the first is still being authorised leaves no channel of the first', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = setup({ gate });
    world.port.subscribe(GRANT, handlers());
    world.port.subscribe(GRANT, handlers());
    release();
    await settle();
    expect(world.clients.map((client) => client.channels.length)).toEqual([0, 1]);
    expect(world.clients.map((client) => client.live)).toEqual([false, true]);
  });

  it('the first one’s unsubscribe, called late, does not close the second', async () => {
    const world = setup();
    const offFirst = world.port.subscribe(GRANT, handlers());
    await settle();
    world.port.subscribe(GRANT, handlers());
    await settle();
    offFirst();
    await settle();
    expect(world.clients[0].disconnects).toBe(1);
    expect(world.clients[1].live).toBe(true);
  });

  it('after a drop, the caller re-authenticates by subscribing again with a fresh grant', async () => {
    const world = setup();
    const h = handlers();
    const off = world.port.subscribe(GRANT, h);
    await settle();
    const expired = world.clients[0].channels[0];
    expired.status('SUBSCRIBED');
    expired.status('CHANNEL_ERROR');
    expect(h.onDown).toHaveBeenCalledTimes(1);

    off();
    const fresh = { ...GRANT, token: 'a-fresh-grant-token' };
    world.port.subscribe(fresh, h);
    await settle();
    const [old, renewed] = world.clients;
    expect(old.live).toBe(false);
    expect(renewed.token).toBe('a-fresh-grant-token');
    renewed.channels[0].status('SUBSCRIBED');
    renewed.channels[0].broadcast('state_changed', {});
    expect(h.onUp).toHaveBeenCalledTimes(2);
    expect(h.onPing).toHaveBeenCalledTimes(1);
  });
});

describe('the Realtime port: a grant or a library that cannot be used', () => {
  it.each([
    ['plain http', 'http://abcdwxyz.supabase.example'],
    ['a websocket scheme', 'wss://abcdwxyz.supabase.example'],
    ['user information', 'https://user:pass@abcdwxyz.supabase.example'],
    ['a backslash host', 'https://evil.example\\.supabase.example'],
    ['no host', 'https://'],
    ['not a URL', 'abcdwxyz.supabase.example'],
    ['nothing', ''],
  ])('refuses %s: down, with no client made', async (_name, url) => {
    const world = setup();
    const h = handlers();
    world.port.subscribe({ ...GRANT, url }, h);
    await settle();
    expect(world.clients).toHaveLength(0);
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(h.onUp).not.toHaveBeenCalled();
    expect(world.lines).toEqual([
      { level: 'warn', event: 'scoring.realtime', fields: { state: 'refused', problem: 'url' } },
    ]);
  });

  it('never calls back before subscribe has returned', async () => {
    const world = setup();
    const h = handlers();
    const unsubscribe = world.port.subscribe({ ...GRANT, url: 'http://x.example' }, h);
    expect(h.onDown).not.toHaveBeenCalled();
    await settle();
    expect(h.onDown).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('a caller that unsubscribes at once is not told about a refusal', async () => {
    const world = setup();
    const h = handlers();
    world.port.subscribe({ ...GRANT, url: 'http://x.example' }, h)();
    await settle();
    expect(h.onDown).not.toHaveBeenCalled();
    expect(world.lines).toEqual([]);
  });

  it('nor is one that unsubscribes before a token the library then refuses', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = setup({ gate, authRejects: true });
    const h = handlers();
    world.port.subscribe(GRANT, h)();
    release();
    await settle();
    expect(h.onDown).not.toHaveBeenCalled();
    expect(world.lines).toEqual([]);
  });

  it('a library that cannot start (no WebSocket in the runtime) is down, and says so without the key', async () => {
    const world = setup({ createThrows: true });
    const h = handlers();
    world.port.subscribe(GRANT, h);
    await settle();
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(world.lines).toEqual([
      { level: 'warn', event: 'scoring.realtime', fields: { state: 'down', problem: 'client' } },
    ]);
  });

  it('a token the library refuses is down, opens no channel and lets the socket go', async () => {
    const world = setup({ authRejects: true });
    const h = handlers();
    world.port.subscribe(GRANT, h);
    await settle();
    expect(world.clients[0].channels).toHaveLength(0);
    expect(world.clients[0].live).toBe(false);
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(world.lines).toEqual([
      { level: 'warn', event: 'scoring.realtime', fields: { state: 'down', problem: 'start' } },
    ]);
  });

  it('a subscription that fails to start is closed: a status the library reports after it is not heard', async () => {
    const world = setup({ subscribeThrows: true });
    const h = handlers();
    world.port.subscribe(GRANT, h);
    await settle();
    expect(h.onDown).toHaveBeenCalledTimes(1);
    world.clients[0].channels[0].status('SUBSCRIBED');
    world.clients[0].channels[0].broadcast('state_changed', {});
    expect(h.onUp).not.toHaveBeenCalled();
    expect(h.onPing).not.toHaveBeenCalled();
    expect(world.clients[0].live).toBe(false);
  });

  it('a channel the library cannot make is down too', async () => {
    const world = setup({ channelThrows: true });
    const h = handlers();
    world.port.subscribe(GRANT, h);
    await settle();
    expect(h.onDown).toHaveBeenCalledTimes(1);
    expect(world.clients[0].live).toBe(false);
  });
});

describe('the Realtime port: what it says', () => {
  it('says each change of the channel once, by the library’s own word, and never a ping', async () => {
    const { channel, lines } = await joined();
    channel.status('SUBSCRIBED');
    channel.status('SUBSCRIBED');
    channel.broadcast('state_changed', {});
    channel.status('CHANNEL_ERROR');
    channel.status('TIMED_OUT');
    expect(lines).toEqual([
      { level: 'info', event: 'scoring.realtime', fields: { state: 'up', status: 'SUBSCRIBED' } },
      {
        level: 'warn',
        event: 'scoring.realtime',
        fields: { state: 'down', status: 'CHANNEL_ERROR' },
      },
    ]);
  });

  it.each([
    ['SUBSCRIBED', 'up'],
    ['CLOSED', 'down'],
    ['CHANNEL_ERROR', 'down'],
    ['TIMED_OUT', 'down'],
  ])('says the library’s own word %s, as %s', async (word, state) => {
    const { channel, lines } = await joined();
    channel.status(word);
    expect(lines).toEqual([
      {
        level: state === 'up' ? 'info' : 'warn',
        event: 'scoring.realtime',
        fields: { state, status: word },
      },
    ]);
  });

  it('a word the port does not know is said as other, never as the library sent it', async () => {
    const { channel, lines } = await joined();
    channel.status(`SURPRISE ${TOKEN}`);
    expect(lines).toEqual([
      { level: 'warn', event: 'scoring.realtime', fields: { state: 'down', status: 'other' } },
    ]);
  });

  it('no line of any run carries the token, the key or the channel', async () => {
    const world = setup();
    const h = handlers();
    h.onPing.mockImplementation(() => {
      throw new Error('boom');
    });
    world.port.subscribe(GRANT, h);
    await settle();
    const channel = world.clients[0].channels[0];
    channel.status('SUBSCRIBED');
    channel.broadcast('state_changed', {});
    channel.status('CHANNEL_ERROR');
    world.port.subscribe({ ...GRANT, url: 'http://abcdwxyz.supabase.example' }, handlers());
    world.port.subscribe(GRANT, handlers());
    await settle();
    const refused = setup({ authRejects: true, createThrows: false });
    refused.port.subscribe(GRANT, handlers());
    const broken = setup({ createThrows: true });
    broken.port.subscribe(GRANT, handlers());
    await settle();
    const said = JSON.stringify([world.lines, refused.lines, broken.lines]);
    expect(said).toContain('scoring.realtime');
    for (const secret of [TOKEN, APIKEY, GRANT.channel, 'abcdwxyz']) {
      expect(said).not.toContain(secret);
    }
  });

  it('every field and event it writes passes the record’s allow-list unmasked', async () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protectLink(TOKEN);
    const clients: FakeClient[] = [];
    const port = createSupabaseRealtimePort({
      createClient: (endpoint, options) => {
        const client = new FakeClient(endpoint, options, {});
        clients.push(client);
        return client;
      },
      logger,
    });
    const h = handlers();
    h.onPing.mockImplementation(() => {
      throw new Error('boom');
    });
    port.subscribe(GRANT, h);
    await settle();
    clients[0].channels[0].status('SUBSCRIBED');
    clients[0].channels[0].broadcast('state_changed', {});
    clients[0].channels[0].status('TIMED_OUT');
    port.subscribe({ ...GRANT, url: 'http://x.example' }, handlers());
    await settle();
    const lines = record.lines().map((text) => parseRecordLine(text));
    expect(lines.map((line) => [line.event, line.fields])).toEqual([
      ['scoring.realtime', { state: 'up', status: 'SUBSCRIBED' }],
      ['scoring.realtime', { state: 'handler', problem: 'threw' }],
      ['scoring.realtime', { state: 'down', status: 'TIMED_OUT' }],
      ['scoring.realtime', { state: 'refused', problem: 'url' }],
    ]);
  });
});
