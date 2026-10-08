import type { SessionState } from '@/domain/session/SessionState';

type Kind = SessionState['kind'];

/** Native's delivery word (`Telemetry['delivery']`). A type test in `useViewerFeed.test.tsx` keeps the two equal. */
export type DeliveryWord = 'ok' | 'stalled' | 'unknown';

/** What the viewer layer shows. `none`: nothing to show. */
export type Feed = 'none' | 'waiting' | 'playing' | 'unavailable';

/**
 * D8: about three times the hypothesised 18–23 s for Cloudflare's first window (spec §9; unmeasured, SB2). After
 * it the layer says so; a later window still recovers it. A timeout, not a clock.
 */
export const FIRST_WINDOW_PATIENCE_MS = 60_000;

export type FeedInput = {
  readonly kind: Kind;
  readonly hasUrl: boolean;
  readonly delivery: DeliveryWord;
  /** A window has been delivered in this stretch of the broadcast (latched by the hook; cleared by a hold). */
  readonly everDelivered: boolean;
  /** The first window did not come within the patience (set by the hook's timer). */
  readonly patienceOver: boolean;
  /** The player failed and its retries are spent. */
  readonly playerFailed: boolean;
};

const HELD_NOT_LIVE: ReadonlySet<Kind> = new Set(['arming', 'armed', 'connecting']);
const LIVE: ReadonlySet<Kind> = new Set(['publishing', 'degraded']);

/**
 * A display rule over the engine's word, not a second state machine (AGENTS §2). The player is mounted only in
 * `playing`: never against a manifest nobody has seen (the cause of a blank layer), and never across a hold,
 * whose playlist is stale (D6, D7).
 */
export function viewerFeed(input: FeedInput): Feed {
  const { kind } = input;
  if (!input.hasUrl) return 'none';
  if (HELD_NOT_LIVE.has(kind)) return 'waiting';
  if (kind === 'reconnecting') return 'unavailable';
  if (!LIVE.has(kind)) return 'none';
  if (input.delivery === 'stalled') return 'unavailable';
  if (input.everDelivered || input.delivery === 'ok')
    return input.playerFailed ? 'unavailable' : 'playing';
  return input.patienceOver ? 'unavailable' : 'waiting';
}
