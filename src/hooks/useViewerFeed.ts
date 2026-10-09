import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import { viewerFeed, type DeliveryWord, type Feed } from '@/domain/session/viewerFeed';
import { selectDelivery, selectPlaybackUrl, selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import { useStableCallback } from '@/hooks/useStableCallback';
import type { VideoStatus } from '@/services/surfaces';

type Kind = SessionState['kind'];

/** D2 §4.3: one quiet retry inside the view's 5 s loading window, then the player is given up on (D6). */
export const PLAYER_RETRY_MS: readonly number[] = [2_000];

export type ViewerFeed = {
  readonly feed: Feed;
  /** The player's remount key: a retry is a fresh player, because expo-video takes its source at creation. */
  readonly attempt: number;
  onStatus(status: VideoStatus): void;
};

const LIVE: ReadonlySet<Kind> = new Set(['publishing', 'degraded']);
/** D7 and the next broadcast: nothing is held, so nothing carries over. */
const OVER: ReadonlySet<Kind> = new Set(['idle', 'pairing', 'paired', 'ended']);
/**
 * What ends a stretch of the broadcast: a hold (the Cloudflare session may be new after it), or one broadcast
 * giving way to the next. Never the player's own failure: that is the player's to give up on (M30c).
 */
const endsStretch = (kind: Kind): boolean => kind === 'reconnecting' || OVER.has(kind);

/**
 * What the viewer layer shows, and when its player starts and restarts (spec §9). The rule is
 * `viewerFeed`; this hook owns what the rule cannot know: whether a window has ever been delivered in this
 * stretch, and where the player is in its retries.
 * Every record line it writes names a state or a number, never a URL (M32). `pressed` is What viewers see
 * open: opening it again after the layer gave up tries again (R1). `mounted` is the view holding a player: when
 * it is not, no Video exists, whatever the feed says. The view keeps no warm player (D2 §4.3), so the two are
 * the same today.
 */
export function useViewerFeed(pressed: boolean, mounted: boolean): ViewerFeed {
  const kind = useEngineSelector(selectStateKind);
  const hasUrl = useEngineSelector(selectPlaybackUrl) !== null;
  const delivery = useEngineSelector(selectDelivery);
  const first = useFirstWindow(kind, delivery, hasUrl);
  const player = usePlayer();
  const feed = viewerFeed({ kind, hasUrl, delivery, ...first, playerFailed: player.failed });
  useFeedLines(feed, delivery);
  useResetPlayer(kind, player.reset);
  useParkPlayer(feed, mounted, player.park);
  useRetryOnPress(pressed, player.failed, player.reset);
  return useMemo(
    () => ({
      feed,
      attempt: player.attempt,
      onStatus: player.onStatus,
    }),
    [feed, player.attempt, player.onStatus],
  );
}

/**
 * D7: whether a window has been delivered in this stretch (latched, so one failed poll does not take the
 * player down). The stretch runs from the broadcast first reading Publishing or Degraded; a hold, or anything
 * not live, ends it.
 */
function useFirstWindow(kind: Kind, delivery: DeliveryWord, hasUrl: boolean) {
  const { logger, clock } = usePorts();
  const liveSince = useRef<number | null>(null);
  // Whether this viewfinder saw the stretch BEGIN, a not-live to live edge. Opened mid-broadcast it did not, and
  // the time since it first looked is not the time to the first window, so none is recorded (R3).
  const sawStart = useRef(false);
  const before = useRef<Kind | null>(null);
  // The latch as the effects see it; `everDelivered` is the same fact for the render. A ref, so StrictMode's
  // second run of the same effect cannot log the window twice.
  const latched = useRef(false);
  const [everDelivered, setEverDelivered] = useState(false);

  useEffect(() => {
    if (LIVE.has(kind)) {
      if (liveSince.current === null) {
        liveSince.current = clock().getTime();
        sawStart.current = before.current !== null && !LIVE.has(before.current);
      }
    } else {
      liveSince.current = null;
      sawStart.current = false;
      if (endsStretch(kind)) {
        latched.current = false;
        setEverDelivered(false);
      }
    }
    before.current = kind;
  }, [kind, clock]);

  useEffect(() => {
    if (delivery !== 'ok' || !hasUrl || !LIVE.has(kind) || latched.current) return;
    latched.current = true;
    setEverDelivered(true);
    if (!sawStart.current) return;
    const now = clock().getTime();
    logger.info('peek.firstWindow', { ms: now - (liveSince.current ?? now) });
  }, [delivery, hasUrl, kind, clock, logger]);

  return { everDelivered };
}

/**
 * D6: the player's retries. A failure waits its rung of `PLAYER_RETRY_MS` and then remounts
 * the player (`attempt` is its key, which only ever counts up); with the rungs spent the player is given up on
 * until a stretch ends or the view opens again. A player that shows a picture earns its rungs back (R2), and
 * that must not remount it: the key and the rung are two counters. `onStatus` keeps its identity: the native
 * Video subscribes to it.
 */
function usePlayer() {
  const { logger } = usePorts();
  const [key, setKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const rung = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (retry.current !== null) clearTimeout(retry.current);
    retry.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onStatus = useCallback(
    (reported: VideoStatus) => {
      if (reported === 'ready') rung.current = 0;
      // A loading report, a rebuffer included, changes nothing here: a real stall reaches `unavailable` by the
      // delivery rule (M54).
      if (reported !== 'failed') return;
      // One failure at a time: a second report from the same player is the same failure.
      if (retry.current !== null) return;
      const step = rung.current;
      const wait = PLAYER_RETRY_MS[step];
      if (wait === undefined) {
        setFailed(true);
        return;
      }
      logger.info('peek.retry', { attempt: step });
      retry.current = setTimeout(() => {
        retry.current = null;
        rung.current += 1;
        setKey((was) => was + 1);
      }, wait);
    },
    [logger],
  );

  /** A fresh start: the whole schedule, no give-up. The player on screen, if any, is left alone. */
  const reset = useCallback(() => {
    rung.current = 0;
    setFailed(false);
  }, []);

  // No player is on screen: a retry it was waiting to do is not owed, since the next mount is a fresh player anyway.
  return { attempt: key, failed, onStatus, reset, park: cancel };
}

/** One line each time what the layer shows changes, with the word that came with it. */
function useFeedLines(feed: Feed, delivery: DeliveryWord): void {
  const { logger } = usePorts();
  const say = useStableCallback(() => logger.info('peek.state', { state: feed, delivery }));
  useEffect(() => say(), [feed, say]);
}

/** A hold or a new broadcast gives the next stretch a fresh player and its full schedule (D7). */
function useResetPlayer(kind: Kind, reset: () => void): void {
  useEffect(() => {
    if (endsStretch(kind)) reset();
  }, [kind, reset]);
}

/**
 * While the feed is not `playing`, or the view holds no player (it closed), there is no Video: a retry
 * waiting for one is moot (the next mount is a fresh player anyway). Never clears a give-up (M30c).
 */
function useParkPlayer(feed: Feed, mounted: boolean, park: () => void): void {
  useEffect(() => {
    if (!mounted || feed !== 'playing') park();
  }, [feed, mounted, park]);
}

/**
 * R1: What viewers see opening after the layer gave up is the operator asking to see it. The opening EDGE, and
 * only after a give-up: an opening before one gives nothing back (R1b).
 */
function useRetryOnPress(pressed: boolean, failed: boolean, reset: () => void): void {
  const was = useRef(false);
  useEffect(() => {
    const landed = pressed && !was.current;
    was.current = pressed;
    if (landed && failed) reset();
  }, [pressed, failed, reset]);
}
