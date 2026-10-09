import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import {
  IDLE,
  viewerCheck,
  type ViewerCheck,
  type ViewerEvent,
} from '@/domain/session/viewerCheck';
import { usePorts } from '@/hooks/usePorts';
import { useTurnCardShowing } from '@/hooks/useTurnCard';
import type { Logger } from '@/services/logger';

export type ViewerCheckView = {
  readonly kind: ViewerCheck['kind'];
  /** The peek cell's tap: opens from idle, closes an open view (never extends it). */
  toggle(): void;
  /** The cover's own tap, and Hide. */
  close(): void;
  /** The player showed its first picture. */
  firstFrame(): void;
};

type Input = {
  /** On air with a viewer picture (`useViewfinder`'s `peekable`). */
  readonly available: boolean;
  /** Any step down the ladder: the first rung is this view (D2 §4.2). */
  readonly shed: boolean;
  /** The Remote scoring panel is up: one cover at a time (D2 §4.3). */
  readonly scoringOpen: boolean;
  /** Takes the scoring panel down when this view opens. Stable (`useScoringLink`'s `hide`). */
  readonly hideScoring: () => void;
};

const CLOSE: ViewerEvent = { kind: 'close' };

/**
 * What viewers see (D2 §4.3): `viewerCheck` decides, this owns the timers and the reasons to close. The view closes
 * on a shed, off air or with no playback URL (`available`), when the scoring panel opens, while the turn card covers
 * the stage (ruling N4) and when the app leaves the foreground (ruling M5). It never re-opens by itself.
 */
export function useViewerCheck(input: Input): ViewerCheckView {
  const { clock, foreground, logger } = usePorts();
  const turnCard = useTurnCardShowing();
  const [state, dispatch] = useReducer(viewerCheck, IDLE);
  const blocked = !input.available || input.shed || turnCard;
  useDeadline(state, dispatch, clock);
  useCloseWhen(blocked || input.scoringOpen, dispatch);
  useEffect(() => foreground.subscribeBackground(() => dispatch(CLOSE)), [foreground]);
  useStateLines(state.kind, logger);
  const toggle = useToggle(state.kind, blocked, input.hideScoring, dispatch, clock);
  const firstFrame = useFirstFrame(state.kind, dispatch, clock, logger);
  const close = useCallback(() => dispatch(CLOSE), []);
  // M7: the same object until the kind changes, so the memoised stage and column skip.
  return useMemo(
    () => ({ kind: state.kind, toggle, close, firstFrame }),
    [state.kind, toggle, close, firstFrame],
  );
}

/** One timer for the open state's deadline, cleared with it. The deadline is the state's own `until`. */
function useDeadline(state: ViewerCheck, dispatch: Dispatch<ViewerEvent>, clock: () => Date) {
  useEffect(() => {
    if (state.kind === 'idle') return undefined;
    const { until } = state;
    const wait = Math.max(0, until - clock().getTime());
    const timer = setTimeout(() => dispatch({ kind: 'deadline', at: until }), wait);
    return () => clearTimeout(timer);
  }, [state, dispatch, clock]);
}

function useCloseWhen(closed: boolean, dispatch: Dispatch<ViewerEvent>) {
  useEffect(() => {
    if (closed) dispatch(CLOSE);
  }, [closed, dispatch]);
}

/** Opening takes the scoring panel down first (one cover at a time); a blocked view opens nothing. */
function useToggle(
  kind: ViewerCheck['kind'],
  blocked: boolean,
  hideScoring: () => void,
  dispatch: Dispatch<ViewerEvent>,
  clock: () => Date,
) {
  const latest = useRef({ kind, blocked });
  useEffect(() => {
    latest.current = { kind, blocked };
  });
  return useCallback(() => {
    const now = latest.current;
    if (now.kind === 'idle') {
      if (now.blocked) return;
      hideScoring();
    }
    dispatch({ kind: 'tap', at: clock().getTime() });
  }, [hideScoring, dispatch, clock]);
}

/** PD6: the time from the tap to the first picture, for spec §8's HLS risk. The tap's time is held only while loading. */
function useFirstFrame(
  kind: ViewerCheck['kind'],
  dispatch: Dispatch<ViewerEvent>,
  clock: () => Date,
  logger: Logger,
) {
  const tappedAt = useRef<number | null>(null);
  useEffect(() => {
    if (kind === 'loading') tappedAt.current ??= clock().getTime();
    else if (kind !== 'showing') tappedAt.current = null;
  }, [kind, clock]);
  return useCallback(() => {
    const at = clock().getTime();
    if (tappedAt.current !== null) {
      logger.info('viewer.firstFrame', { ms: at - tappedAt.current });
      tappedAt.current = null;
    }
    dispatch({ kind: 'firstFrame', at });
  }, [dispatch, clock, logger]);
}

/** PD6: one line each time the view's state changes, after the first (a mount at idle is not news). */
function useStateLines(kind: ViewerCheck['kind'], logger: Logger) {
  const before = useRef(kind);
  useEffect(() => {
    if (before.current === kind) return;
    before.current = kind;
    logger.info('viewer.check', { state: kind });
  }, [kind, logger]);
}
