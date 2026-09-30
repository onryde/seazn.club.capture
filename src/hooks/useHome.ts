import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { type Result, err } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { Mode, ModeCode } from '@/domain/mode/Mode';
import { recognise } from '@/domain/mode/recognise';
import { isExpired, savedCodeFrom, venueZone, type SavedCode } from '@/domain/mode/savedCode';
import { scanOutcome, type ScanOutcome } from '@/domain/mode/scanOutcome';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import type { CodeScannerPort, ScanResult, ScanUnavailableReason } from '@/scanner/CodeScannerPort';
import type { DescriptorPort } from '@/services/descriptorPort';
import type { Logger } from '@/services/logger';
import type { ModeStore, ModeStoreSnapshot } from '@/services/modeStore';

/** A scan that did not simply open: what the panel explains. */
export type PanelOutcome = Exclude<ScanOutcome, { kind: 'open' }>;
export type StreamCode = Extract<ModeCode, { mode: 'stream' }>;

/** What the panel shows: a scan's outcome, the check in flight, or the server's refusal. */
export type HomePanel =
  | PanelOutcome
  | { readonly kind: 'checking'; readonly tapped: Mode }
  | {
      readonly kind: 'descriptorError';
      readonly tapped: Mode;
      readonly error: DescriptorError;
      readonly code: StreamCode;
    };

export type HomeView = {
  readonly statusText: string;
  readonly panel: HomePanel | null;
  readonly panelTime: string | null;
  readonly continueCode: SavedCode | null;
  readonly continueTill: string | null;
};

export type HomeActions = {
  tapTile(mode: Mode): void;
  scanAgain(): void;
  openFromPanel(code: ModeCode): void;
  closePanel(): void;
  /** Try again on the no-connection panel: the same code, checked again (D27). */
  retryCheck(): void;
  continueStream(): void;
  forgetStream(): void;
  /** Development builds only: a pasted code, handled as if scanned from Live Stream. */
  useRaw(raw: string): void;
};

type SetPanel = Dispatch<SetStateAction<HomePanel | null>>;
/** Home's own line of news: a scanner reason, or a refused save. Cleared by the next tap. */
type SetStatusKey = (key: MessageKey | null) => void;
type OpenCode = (code: ModeCode, descriptor: SessionDescriptor | null) => Promise<void>;
type OpenOrCheck = (code: ModeCode) => Promise<void>;
type Answer = Result<SessionDescriptor, DescriptorError>;
type HandleScan = (tapped: Mode, result: ScanResult) => Promise<void>;
type ReadyStore = Extract<ModeStoreSnapshot, { status: 'ready' }>;
/** Which of Home's writes the phone refused, as the record names it. */
type SaveAction = 'open' | 'continue' | 'forget';
type SaveFailed = (action: SaveAction) => void;

const SCANNER_MESSAGE: Readonly<Record<ScanUnavailableReason, MessageKey>> = {
  noPlayServices: 'scanner.noPlayServices',
  installing: 'scanner.installing',
  failed: 'scanner.failed',
};

const DID_NOT_OPEN: ScanResult = { outcome: 'unavailable', reason: 'failed' };
const NO_ANSWER: Answer = err({ kind: 'offline' });
const CHECKING: HomePanel = { kind: 'checking', tapped: 'stream' };

/**
 * Ruling R12: the store takes writes only once it is `ready`. Read at call
 * time, not from a render, so a tap never acts on a stale snapshot.
 */
function isReady(store: ModeStore): boolean {
  return store.getSnapshot().status === 'ready';
}

function savedStream(store: ModeStore): SavedCode | null {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.stream ?? null) : null;
}

/**
 * A throw that is not a refused write is a bug (in navigation, say). Nothing
 * true can be said about it, so Home stays as it was, still usable, and no
 * rejection escapes. Refused writes never land here: they say so (R19).
 */
function ignoreUnexpected(): void {}

/**
 * Home's behaviour (spec §3): tap, scan, recognise, then open or explain.
 */
export function useHome(): { view: HomeView; actions: HomeActions } {
  const { modeStore } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const [panel, setPanel] = useState<HomePanel | null>(null);
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null);
  const saveFailed = useSaveFailed(setStatusKey);
  const openCode = useOpenCode(setStatusKey, saveFailed);
  const openOrCheck = useOpenOrCheck(openCode, setPanel);
  const handle = useHandleScan(openOrCheck, setPanel, setStatusKey);
  const tapTile = useTapTile(handle, setPanel, setStatusKey);
  const view = useHomeView(snapshot, panel, statusKey);
  const panelActions = usePanelActions(panel, tapTile, openOrCheck, setPanel);
  const retryCheck = useRetryCheck(panel, openOrCheck);
  useBusyRetry(panel, retryCheck);
  const continueStream = useContinue(setStatusKey, saveFailed);
  const forgetStream = useForget(setStatusKey, saveFailed);
  const pasteRaw = usePaste(handle);
  const actions = {
    tapTile,
    ...panelActions,
    retryCheck,
    continueStream,
    forgetStream,
    useRaw: pasteRaw,
  };
  return { view, actions };
}

/**
 * Ruling R19: a write the phone refuses is never silent — on screen, and now
 * in the record too (spec §5). It outranks any notice, so the notices are
 * dismissed and the refusal takes the line.
 */
function useSaveFailed(setStatusKey: SetStatusKey): SaveFailed {
  const { modeStore, logger } = usePorts();
  return useCallback(
    (action: SaveAction) => {
      logger.warn('store.write-refused', { action });
      modeStore.dismissNotices();
      setStatusKey('store.saveFailed');
    },
    [modeStore, logger, setStatusKey],
  );
}

/**
 * Save the code and make it active, then open its mode. A code that could not
 * be saved is not opened: the stream screen reads it back from the store.
 */
function useOpenCode(setStatusKey: SetStatusKey, saveFailed: SaveFailed): OpenCode {
  const { modeStore, clock, navigation } = usePorts();
  return useCallback(
    async (code: ModeCode, descriptor: SessionDescriptor | null) => {
      if (!isReady(modeStore)) return;
      try {
        await modeStore.open(savedCodeFrom(code, clock(), descriptor));
      } catch {
        return saveFailed('open');
      }
      setStatusKey(null);
      if (code.mode === 'stream') navigation.go('stream');
    },
    [modeStore, clock, navigation, setStatusKey, saveFailed],
  );
}

/**
 * Spec §1: a stream code is checked with the server before anything is saved.
 * The scan flight is still up while this runs, so a second tap is ignored
 * until the answer is in. A store that is not ready is not asked (R12), and a
 * port that throws or rejects is read as no connection.
 */
function useOpenOrCheck(openCode: OpenCode, setPanel: SetPanel): OpenOrCheck {
  const { descriptor, modeStore, logger } = usePorts();
  return useCallback(
    async (code: ModeCode) => {
      if (code.mode !== 'stream') return openCode(code, null);
      if (!isReady(modeStore)) return;
      setPanel(CHECKING);
      const answer = await askSafely(descriptor, code, logger);
      if (!answer.ok) {
        return setPanel({ kind: 'descriptorError', tapped: 'stream', error: answer.error, code });
      }
      setPanel(null);
      await openCode(code, answer.value);
    },
    [descriptor, modeStore, logger, openCode, setPanel],
  );
}

/**
 * A port that throws, synchronously or by rejecting, is no connection: the
 * panel always settles, never "Checking code…" for good (a missing module).
 * The fetch port logs its own refusals; a throw is recorded here, so it is
 * never silent either (spec §5). The token is never a field.
 */
async function askSafely(
  descriptor: DescriptorPort,
  code: StreamCode,
  logger: Logger,
): Promise<Answer> {
  try {
    return await descriptor.fetch(code.sid, code.token);
  } catch {
    logger.warn('descriptor.error', { kind: 'offline', status: 0, problem: 'port-threw' });
    return NO_ANSWER;
  }
}

/**
 * Try again (offline) and the busy retry (D5): the same code, under a scan
 * flight of its own so a tile tap cannot interleave, and a second press
 * before the first is answered asks nothing more.
 */
function useRetryCheck(panel: HomePanel | null, openOrCheck: OpenOrCheck): () => void {
  const { scanFlight } = usePorts();
  return useCallback(() => {
    if (panel?.kind !== 'descriptorError') return;
    if (!scanFlight.begin()) return;
    void openOrCheck(panel.code)
      .catch(ignoreUnexpected)
      .finally(() => scanFlight.end());
  }, [panel, openOrCheck, scanFlight]);
}

/** D5: one automatic retry per 429 answer, cancelled if the panel changes first. */
function useBusyRetry(panel: HomePanel | null, retry: () => void): void {
  useEffect(() => {
    if (panel?.kind !== 'descriptorError' || panel.error.kind !== 'rate-limited') return;
    const timer = setTimeout(retry, panel.error.retryAfterS * 1000);
    return () => clearTimeout(timer);
  }, [panel, retry]);
}

/**
 * One scan's result: nothing, a reason on the status line, an open, or a
 * panel. Settles only once any check and save have, so the scan guard covers
 * both.
 */
function useHandleScan(
  openOrCheck: OpenOrCheck,
  setPanel: SetPanel,
  setStatusKey: SetStatusKey,
): HandleScan {
  const { clock, hosts } = usePorts();
  return useCallback(
    async (tapped: Mode, result: ScanResult) => {
      if (result.outcome === 'cancelled') return;
      if (result.outcome === 'unavailable') return setStatusKey(SCANNER_MESSAGE[result.reason]);
      const outcome = scanOutcome(tapped, recognise(result.raw, clock(), hosts));
      if (outcome.kind === 'open') return openOrCheck(outcome.code);
      setPanel(outcome);
    },
    [clock, hosts, openOrCheck, setPanel, setStatusKey],
  );
}

/**
 * One scan at a time. A second native `startScan()` cancels the first, or
 * fails with status 204 (Task 8), so taps are ignored while the scanner is up
 * and while its code is being saved. The same flight holds the reopen gate off
 * the return from the scanner (I2). It ends on every outcome, a broken scanner
 * included, so Home can never be left with no way to scan.
 */
function useTapTile(
  handle: HandleScan,
  setPanel: SetPanel,
  setStatusKey: SetStatusKey,
): (mode: Mode) => void {
  const { modeStore, scanner, scanFlight } = usePorts();
  return useCallback(
    (mode: Mode) => {
      // Ready first: a tap on a loading store must not raise the flag.
      if (!isReady(modeStore)) return;
      if (!scanFlight.begin()) return;
      setPanel(null);
      setStatusKey(null);
      modeStore.dismissNotices();
      void scanSafely(scanner)
        .then((result) => handle(mode, result))
        .catch(ignoreUnexpected)
        .finally(() => scanFlight.end());
    },
    [modeStore, scanner, scanFlight, handle, setPanel, setStatusKey],
  );
}

/**
 * A scanner that throws, synchronously or by rejecting, reads as one that
 * didn't open: the status line says so, and nothing is left unhandled.
 */
async function scanSafely(scanner: CodeScannerPort): Promise<ScanResult> {
  try {
    return await scanner.scan();
  } catch {
    return DID_NOT_OPEN;
  }
}

function useHomeView(
  snapshot: ModeStoreSnapshot,
  panel: HomePanel | null,
  statusKey: MessageKey | null,
): HomeView {
  const { t } = useT();
  const { clock } = usePorts();
  const format = useFormatTime();
  const ready = snapshot.status === 'ready' ? snapshot : null;
  const stream = ready?.saved.codes.stream ?? null;
  const continueCode = stream !== null && !isExpired(stream, clock()) ? stream : null;
  // Never null for an expired panel, which would read "expired at ." (Task 10 carry).
  const panelTime = panel?.kind === 'expired' ? format(panel.at, null) : null;
  return {
    statusText: statusText(ready, statusKey, t, format),
    panel,
    panelTime,
    continueCode,
    continueTill: continueCode?.expiresAt
      ? format(continueCode.expiresAt, venueZone(continueCode))
      : null,
  };
}

/**
 * What the one status line says, most important first (AGENTS §6: always
 * something true). A refused save outranks the notices by dismissing them.
 */
function statusText(
  ready: ReadyStore | null,
  statusKey: MessageKey | null,
  t: Translator['t'],
  format: (at: Date, zone: string | null) => string,
): string {
  const notice = ready?.notice ?? null;
  if (notice !== null) {
    const mode = t(MODE_NAME[notice.mode]);
    return t('reopen.expired', { mode, time: format(notice.expiredAt, notice.venueTz) });
  }
  if (ready?.dropped) return t('store.unreadable');
  if (statusKey !== null) return t(statusKey);
  return t('home.status.idle');
}

/**
 * The panel's buttons: open the code it named, scan again from the same tile,
 * or close. Open closes the panel first, so a refused save replaces it. A
 * stream code opened here is checked like a scanned one. "Checking code…"
 * never closes (D27): the fetch's own deadline ends it.
 */
function usePanelActions(
  panel: HomePanel | null,
  tapTile: (mode: Mode) => void,
  openOrCheck: OpenOrCheck,
  setPanel: SetPanel,
): Pick<HomeActions, 'scanAgain' | 'openFromPanel' | 'closePanel'> {
  const scanAgain = useCallback(() => {
    if (panel !== null) tapTile(panel.tapped);
  }, [panel, tapTile]);
  const openFromPanel = useCallback(
    (code: ModeCode) => {
      setPanel(null);
      void openOrCheck(code).catch(ignoreUnexpected);
    },
    [openOrCheck, setPanel],
  );
  const closePanel = useCallback(
    () => setPanel((open) => (open?.kind === 'checking' ? open : null)),
    [setPanel],
  );
  return { scanAgain, openFromPanel, closePanel };
}

/**
 * The Continue button. The card renders only from a `ready` snapshot (R12).
 * Expiry is judged again on the press, against the current clock: a code that
 * ran out while Home sat open is expired the way the reopen gate does it, which
 * removes the card and says so on the status line.
 *
 * Ruling R21: an expired code the phone won't delete is still expired. The
 * store has already published the notice, which is the true message, so a
 * refused expiry raises no `store.saveFailed` — it is only recorded, and the
 * next launch expires it again.
 */
function useContinue(setStatusKey: SetStatusKey, saveFailed: SaveFailed): () => void {
  const { modeStore, navigation, clock, logger } = usePorts();
  return useCallback(() => {
    const code = savedStream(modeStore);
    if (code === null) return;
    if (code.expiresAt !== null && isExpired(code, clock())) {
      const notice = {
        mode: 'stream' as const,
        expiredAt: code.expiresAt,
        venueTz: venueZone(code),
      };
      return void modeStore
        .expire(['stream'], notice)
        .catch(() => logger.warn('store.write-refused', { action: 'expire' }));
    }
    void modeStore
      .setActive('stream')
      .then(
        () => {
          setStatusKey(null);
          navigation.go('stream');
        },
        () => saveFailed('continue'),
      )
      .catch(ignoreUnexpected);
  }, [modeStore, navigation, clock, logger, setStatusKey, saveFailed]);
}

/** The Forget button: immediate, with no confirmation (spec §4). */
function useForget(setStatusKey: SetStatusKey, saveFailed: SaveFailed): () => void {
  const { modeStore } = usePorts();
  return useCallback(() => {
    void modeStore.forget('stream').then(
      () => setStatusKey(null),
      () => saveFailed('forget'),
    );
  }, [modeStore, setStatusKey, saveFailed]);
}

/** Development builds only: a pasted code goes where a Live Stream scan would. */
function usePaste(handle: HandleScan): (raw: string) => void {
  const { devTools } = usePorts();
  return useCallback(
    (raw: string) => {
      if (devTools) void handle('stream', { outcome: 'scanned', raw }).catch(ignoreUnexpected);
    },
    [devTools, handle],
  );
}
