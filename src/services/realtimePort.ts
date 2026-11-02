import { httpsOrigin } from '@/domain/credentials/wire';
import type { Logger } from '@/services/logger';
import type { RealtimeGrant } from '@/services/scoringPort';

/** What the caller hears of the channel. Called after `subscribe` has returned, never before, and never after the unsubscribe. */
export type RealtimeHandlers = {
  /** Another scorer, the console or the server changed the match. The ping carries nothing: read the ledger. */
  readonly onPing: () => void;
  /** The channel is not delivering, and says so once per change, not once per retry of the library. */
  readonly onDown: () => void;
  /**
   * The channel is delivering (joined, or rejoined after a drop). Every `onUp` owes a ledger read: a ping sent while
   * the channel was down was never heard, and the channel signals only what is written from here on.
   */
  readonly onUp: () => void;
};

/**
 * S2's "something changed" channel (design §6.3, ruling 27): a private Supabase Realtime broadcast of
 * `state_changed`, a ping that is only ever a reason to read the ledger, never data (plan S2-1 Task 8).
 *
 * One subscription at a time: a second `subscribe` closes the first, so the app never holds two sockets, and the
 * first's owner is not told (its handlers just stop): the caller keeps a single owner of the channel (plan Task 9).
 * The returned function closes the subscription, and a second call of it is nothing.
 *
 * The grant's token lives 3600 s and the port never renews it: when the channel drops after its hour it says `onDown`
 * and the library keeps retrying with the expired token to no end. The caller polls while it is down, asks for a fresh
 * grant and subscribes again with it (Review Focus 5). A grant that cannot be used (its url is not https, the library
 * cannot start, the token is refused) is `onDown` too, once, and the subscription is closed.
 */
export interface RealtimePort {
  subscribe(grant: RealtimeGrant, handlers: RealtimeHandlers): () => void;
}

/** The part of the library's channel the port uses. `RealtimeChannel` satisfies it; a fake does too. */
export type RealtimeChannelLike = {
  on(type: 'broadcast', filter: { event: string }, callback: () => void): RealtimeChannelLike;
  subscribe(callback: (status: string) => void): RealtimeChannelLike;
};

/** The part of the library's `RealtimeClient` the port uses. */
export type RealtimeClientLike = {
  setAuth(token: string): Promise<void>;
  channel(topic: string, params: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
  disconnect(): Promise<unknown>;
};

/**
 * What the port asks of the library's client, besides the endpoint (a `wss://` URL).
 * - `params.apikey`: the grant's public key.
 * - `vsn` '1.0.0': the server frames every message, `state_changed` included, as JSON text. The library's default,
 *   2.0.0, sends a user broadcast as a binary frame decoded with `TextDecoder`, which Hermes does not have of its own
 *   (Expo's polyfill probably covers it): a decode that threw would be swallowed by the socket's event loop, and the
 *   channel would read up with no ping ever heard. A text frame needs nothing from the runtime.
 * - `disconnectOnEmptyChannelsAfterMs` 0: once the channel is removed the socket goes at once, with no timer (the
 *   library's default is twice its heartbeat) holding the client and the token after the unsubscribe.
 */
export type RealtimeClientOptions = {
  readonly params: { readonly apikey: string };
  readonly vsn: '1.0.0';
  readonly disconnectOnEmptyChannelsAfterMs: 0;
};

/** Builds the library's client for one socket. */
export type RealtimeClientFactory = (
  endpoint: string,
  options: RealtimeClientOptions,
) => RealtimeClientLike;

const EVENT = 'scoring.realtime';
/** The broadcast event the server sends when a match changes (the web's `use-fixture-stream.ts`; design §6.3). */
const STATE_CHANGED = 'state_changed';
const SUBSCRIBED = 'SUBSCRIBED';
/** The library's own words for a channel's status; anything else is said as `other`, never as it came. */
const KNOWN_STATUS: ReadonlySet<string> = new Set([
  SUBSCRIBED,
  'CLOSED',
  'CHANNEL_ERROR',
  'TIMED_OUT',
]);

type Problem = 'url' | 'client' | 'start';

type Subscription = { readonly close: () => void };

/**
 * The https origin of the grant's server as the websocket endpoint the library wants; null when the url is not https
 * (a plain-http or a ws address would carry the token and key in the clear) or names no host. Only the origin is
 * taken: the server's Realtime lives at `/realtime/v1`, and nothing after the host is copied.
 */
function realtimeEndpoint(url: string): string | null {
  const origin = httpsOrigin(url);
  return origin === null ? null : `${origin.replace(/^https:/, 'wss:')}/realtime/v1`;
}

/** Runs `later` after the caller has the unsubscribe in hand: a handler is never called from inside `subscribe`. */
function afterReturn(later: () => void): void {
  void Promise.resolve().then(later);
}

type Deps = { readonly createClient: RealtimeClientFactory; readonly logger: Logger };

/**
 * The production port over `@supabase/realtime-js` (never `supabase-js`), with the client injected so tests drive a
 * fake and the composition root builds the real one (`realtimePortFor`). The log carries closed words only: the state,
 * the library's own status word and a problem class, never the url, the token, the key, the channel or an error's text.
 */
export function createSupabaseRealtimePort(deps: Deps): RealtimePort {
  let current: Subscription | null = null;
  return {
    subscribe: (grant, handlers) => {
      current?.close();
      const subscription = openSubscription(deps, grant, handlers);
      current = subscription;
      return subscription.close;
    },
  };
}

/** One subscription's state. `live` is false from the caller's unsubscribe (or a failed start) on: nothing is heard after. */
type Run = {
  live: boolean;
  released: boolean;
  threw: boolean;
  state: 'connecting' | 'up' | 'down';
  client: RealtimeClientLike | null;
  channel: RealtimeChannelLike | null;
};

function openSubscription(
  deps: Deps,
  grant: RealtimeGrant,
  handlers: RealtimeHandlers,
): Subscription {
  const run: Run = {
    live: true,
    released: false,
    threw: false,
    state: 'connecting',
    client: null,
    channel: null,
  };
  const close = (): void => shut(run, deps.logger);
  const endpoint = realtimeEndpoint(grant.url);
  if (endpoint === null) {
    afterReturn(() => fail(run, deps.logger, handlers, 'url'));
    return { close };
  }
  try {
    run.client = deps.createClient(endpoint, {
      params: { apikey: grant.apikey },
      vsn: '1.0.0',
      disconnectOnEmptyChannelsAfterMs: 0,
    });
  } catch {
    afterReturn(() => fail(run, deps.logger, handlers, 'client'));
    return { close };
  }
  void join(run, deps.logger, grant, handlers);
  return { close };
}

/** Nothing is heard from now on, and the socket goes. The caller's unsubscribe, and the end of a failed start. */
function shut(run: Run, logger: Logger): void {
  run.live = false;
  release(run, logger);
}

/** Lets the socket go: leaves the channel and disconnects, each one said and never thrown if the library fails. */
function release(run: Run, logger: Logger): void {
  if (run.released || run.client === null) return;
  run.released = true;
  const socket = run.client;
  const channel = run.channel;
  if (channel !== null) closing(logger, () => socket.removeChannel(channel));
  closing(logger, () => socket.disconnect());
}

function closing(logger: Logger, attempt: () => Promise<unknown>): void {
  const said = () => logger.warn(EVENT, { state: 'closing', problem: 'close' });
  try {
    attempt().catch(said);
  } catch {
    said();
  }
}

/** The caller's handler, which must never throw into the library's socket loop; said once, in closed words. */
function call(run: Run, logger: Logger, handler: () => void): void {
  if (!run.live) return;
  try {
    handler();
  } catch {
    if (run.threw) return;
    run.threw = true;
    logger.warn(EVENT, { state: 'handler', problem: 'threw' });
  }
}

/** The channel's change, said and handed on once per change; the library's retries repeat it. */
function change(
  run: Run,
  logger: Logger,
  handlers: RealtimeHandlers,
  next: 'up' | 'down',
  status: string,
): void {
  if (!run.live || run.state === next) return;
  run.state = next;
  const fields = { state: next, status: KNOWN_STATUS.has(status) ? status : 'other' };
  if (next === 'up') logger.info(EVENT, fields);
  else logger.warn(EVENT, fields);
  call(run, logger, next === 'up' ? () => handlers.onUp() : () => handlers.onDown());
}

/** A subscription that cannot be had: down once, said, and closed. */
function fail(run: Run, logger: Logger, handlers: RealtimeHandlers, problem: Problem): void {
  if (!run.live) return;
  run.state = 'down';
  logger.warn(EVENT, { state: problem === 'url' ? 'refused' : 'down', problem });
  call(run, logger, () => handlers.onDown());
  shut(run, logger);
}

/** The token first, then the channel: the library puts the token it holds into the join, which a private channel is authorised by. */
async function join(
  run: Run,
  logger: Logger,
  grant: RealtimeGrant,
  handlers: RealtimeHandlers,
): Promise<void> {
  const socket = run.client;
  if (socket === null) return;
  try {
    await socket.setAuth(grant.token);
    if (!run.live) return;
    run.channel = socket
      .channel(grant.channel, { config: { private: true } })
      .on('broadcast', { event: STATE_CHANGED }, () => call(run, logger, () => handlers.onPing()))
      .subscribe((status) =>
        change(run, logger, handlers, status === SUBSCRIBED ? 'up' : 'down', status),
      );
  } catch {
    fail(run, logger, handlers, 'start');
  }
}
