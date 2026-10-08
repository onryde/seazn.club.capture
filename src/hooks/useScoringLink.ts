import { useCallback, useEffect, useRef, useState } from 'react';
import { selectHeldCode, selectHeldSlot, selectHeldTokenTag } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { ScoringWord } from '@/services/scoringLinkPort';

/** Spec §10: the code hides itself after 10 s. Counted from the moment it is shown, not from the tap. */
export const SCORING_SHOW_MS = 10_000;
/** The countdown's first number, in whole seconds: the board shows 10 down to 1 (B3). */
export const SCORING_SHOW_SECONDS = SCORING_SHOW_MS / 1000;
/**
 * The longest Retry-After the phone honours or says, in seconds. Native does not clamp it: any finite value >= 0 can
 * arrive, and a stray day-long one would lock the button and print a number the copy has no room for (the copy
 * budget is written for 300).
 */
export const SCORING_RETRY_MAX_S = 300;

export type ScoringLinkView =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'shown'; readonly url: string }
  | {
      readonly kind: 'refused';
      readonly word: ScoringWord;
      readonly retryAfterS: number | null;
    };

const HIDDEN: ScoringLinkView = { kind: 'hidden' };

/**
 * A server's Retry-After as a whole number of seconds worth saying, or null for none: a number that is not finite, or
 * is zero or below, is no wait at all; any positive wait rounds UP to a whole second (a 0.2 s one is 1 s, so the
 * sentence never says "0 s" while the button is still blocked); and the cap is [SCORING_RETRY_MAX_S].
 */
function clampRetry(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(Math.ceil(raw), SCORING_RETRY_MAX_S);
}

/**
 * Spec §10. The scoring url is a credential, so it lives only in this hook's state while the code is up: never in a
 * store, a ref that outlives it, a log field or the engine. One ask at a time; the answer to an ask that was hidden
 * meanwhile is dropped by its token. `open` and `hide` are stable, so the memoised column skips (M7).
 *
 * B3: while a view is shown or refused it counts down, one tick a second, from 10 to 1. The tick only draws the
 * number: the 10 s timer is what hides, and both are cleared together.
 *
 * R8a: the panel is opaque and covers the status strip, so a session ENTERING trouble (`trouble` goes true: the plate
 * the viewfinder shows as TROUBLE, which is Degraded, Reconnecting and a silent engine) takes it down at once, and the
 * strip's warning is not hidden for up to 10 s. A tap made while trouble already stands is the operator's own choice
 * and is honoured.
 */
export function useScoringLink(trouble: boolean) {
  const { scoringLink, foreground, clock, logger } = usePorts();
  // What names the pairing, as three scalars: a new pairing is a new code, and the link in hand is for the old one.
  const code = useEngineSelector(selectHeldCode);
  const slot = useEngineSelector(selectHeldSlot);
  const tokenTag = useEngineSelector(selectHeldTokenTag);
  const [view, setView] = useState<ScoringLinkView>(HIDDEN);
  const [secondsLeft, setSecondsLeft] = useState(SCORING_SHOW_SECONDS);
  const ask = useRef(0); // the request token: every hide and every new ask moves it
  const busy = useRef(false); // asking, or the code is up: a tap meanwhile is ignored
  const blockedUntil = useRef(0); // epoch ms; the server's Retry-After, honoured even for an answer nobody saw
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (tick.current !== null) clearInterval(tick.current);
    tick.current = null;
  }, []);
  const hide = useCallback(() => {
    ask.current += 1; // whatever is in flight is no longer wanted
    busy.current = false;
    clear();
    setView(HIDDEN);
  }, [clear]);
  const show = useCallback(
    (next: ScoringLinkView) => {
      busy.current = next.kind === 'shown';
      setView(next);
      clear();
      setSecondsLeft(SCORING_SHOW_SECONDS);
      // One tick a second draws the number; the timer, armed beside it, is what hides. At the tenth second the timer
      // fires first under fake timers (measured); were the tick ever first, its 0 and the hide would land in one render
      // that draws no panel, so a 0 is never shown.
      tick.current = setInterval(() => setSecondsLeft((left) => left - 1), 1000);
      timer.current = setTimeout(hide, SCORING_SHOW_MS);
    },
    [clear, hide],
  );
  const open = useCallback(() => {
    if (busy.current) return;
    const waitMs = blockedUntil.current - clock().getTime();
    if (waitMs > 0) {
      // Rate limited: say so again, with what is left, and ask nothing.
      show({ kind: 'refused', word: 'rate_limited', retryAfterS: Math.ceil(waitMs / 1000) });
      return;
    }
    ask.current += 1;
    const token = ask.current;
    busy.current = true;
    clear();
    setView({ kind: 'asking' });
    logger.info('scoring.open');
    void scoringLink.request().then((outcome) => {
      if (!alive.current) return;
      const retryAfterS =
        outcome.kind === 'refused' && outcome.word === 'rate_limited'
          ? clampRetry(outcome.retryAfterS)
          : null;
      if (retryAfterS !== null) blockedUntil.current = clock().getTime() + retryAfterS * 1000;
      if (token !== ask.current) return; // hidden meanwhile: not wanted, never shown
      if (outcome.kind === 'ok') {
        logger.info('scoring.shown'); // the words only: the url is never a log field
        show({ kind: 'shown', url: outcome.url });
        return;
      }
      logger.warn('scoring.refused', { reason: outcome.word, retryAfterS });
      show({ kind: 'refused', word: outcome.word, retryAfterS });
    });
  }, [clock, clear, logger, scoringLink, show]);

  useEffect(() => foreground.subscribeBackground(hide), [foreground, hide]);
  // Another code, or none: the link in hand is for a match this pairing no longer holds, and so is the wait the server
  // set for it (a new pairing is not rate limited by the old one). Runs on mount too: harmless.
  useEffect(() => {
    blockedUntil.current = 0;
    hide();
  }, [code, slot, tokenTag, hide]);
  // R8a: entering trouble takes the panel down (a change to true; on mount it hides what is not there).
  useEffect(() => {
    if (trouble) hide();
  }, [trouble, hide]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clear();
    };
  }, [clear]);
  return { view, secondsLeft, open, hide };
}
