import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CodeError } from '@/domain/credentials/waitingFields';
import { continueCard, type ContinueCopy } from '@/domain/mode/continueCard';
import type { Mode, ModeCode } from '@/domain/mode/Mode';
import { asksBeforeOpening } from '@/domain/mode/otherMode';
import { recognise } from '@/domain/mode/recognise';
import {
  isExpired,
  savedCodeFrom,
  venueZone,
  type SavedCode,
  type SavedStream,
} from '@/domain/mode/savedCode';
import { scanOutcome, type ScanOutcome } from '@/domain/mode/scanOutcome';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import type { UnpairReason } from '@/domain/session/Pairing';
import {
  selectEngineStatus,
  selectHeldCode,
  selectHeldSlot,
  selectHeldTokenTag,
  selectLabel,
  selectStateKind,
  selectUnpairedKey,
  selectUnpairedReason,
} from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import {
  ignoreUnexpected,
  isReady,
  useCodeCheck,
  type OpenCode,
  type OpenOrCheck,
  type SetPanel,
} from '@/hooks/useCodeCheck';
import { useUnpair } from '@/hooks/useUnpair';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { usePairing } from '@/hooks/usePairing';
import { usePorts } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import type { CodeScannerPort, ScanResult, ScanUnavailableReason } from '@/scanner/CodeScannerPort';
import type { ModeStore, ModeStoreSnapshot } from '@/services/modeStore';

/** A scan that did not simply open: what the panel explains. */
export type PanelOutcome = Exclude<ScanOutcome, { kind: 'open' }>;
export type StreamCode = Extract<ModeCode, { mode: 'stream' }>;

/**
 * What the panel shows: a scan's outcome, the check in flight, the server's
 * refusal, or why native left a pairing the operator did not end.
 */
export type HomePanel =
  | PanelOutcome
  | { readonly kind: 'checking'; readonly tapped: Mode }
  | {
      readonly kind: 'codeError';
      readonly tapped: Mode;
      readonly error: CodeError;
      readonly code: StreamCode;
    }
  | { readonly kind: 'unpaired'; readonly tapped: 'stream'; readonly reason: UnpairReason }
  /** A7: another mode while paired asks first; its confirm unpairs, forgets, then opens. */
  | { readonly kind: 'unpairConfirm'; readonly tapped: Mode; readonly code: ModeCode };

export type HomeView = {
  readonly statusText: string;
  readonly panel: HomePanel | null;
  readonly panelTime: string | null;
  readonly continueCode: SavedCode | null;
  /** What the Continue card says (amendment §2, Home); null with no card. */
  readonly continueCopy: ContinueCopy | null;
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
  /** A7's sheet: unpair, forget the stream code, then open the other mode. */
  confirmUnpair(): void;
  /** A7's sheet: keep the pairing; nothing is sent. */
  cancelUnpair(): void;
};

/** Home's own line of news: a scanner reason, or a refused save. Cleared by the next tap. */
type SetStatusKey = (key: MessageKey | null) => void;
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

function savedStream(store: ModeStore): SavedCode | null {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.stream ?? null) : null;
}

/**
 * Home's behaviour (spec §3): tap, scan, recognise, then open or explain.
 */
export function useHome(): { view: HomeView; actions: HomeActions } {
  const { modeStore } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const [panel, setPanel] = useState<HomePanel | null>(null);
  useUnpairedPanel(panel, setPanel);
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null);
  const saveFailed = useSaveFailed(setStatusKey);
  const openCode = useOpenCode(setStatusKey, saveFailed, setPanel);
  const { confirm: confirmUnpair, cancel: cancelUnpair } = useUnpairConfirm(
    panel,
    setPanel,
    openCode,
    saveFailed,
  );
  const { openOrCheck, retryCheck } = useCodeCheck(openCode, panel, setPanel);
  const handle = useHandleScan(openOrCheck, setPanel, setStatusKey);
  const tapTile = useTapTile(handle, setPanel, setStatusKey);
  useScanRequest(snapshot.status === 'ready', tapTile);
  const view = useHomeView(snapshot, panel, statusKey);
  const panelActions = usePanelActions(panel, tapTile, openOrCheck, setPanel);
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
    confirmUnpair,
    cancelUnpair,
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
 * be saved is not opened: the stream screen reads it back from the store. A
 * stream code is paired once it is saved, never before (amendment §2's
 * outcome table: saved, then /stream, then pair).
 */
function useOpenCode(
  setStatusKey: SetStatusKey,
  saveFailed: SaveFailed,
  setPanel: SetPanel,
): OpenCode {
  const { modeStore, clock, navigation, engine } = usePorts();
  const pair = usePairing();
  return useCallback(
    async (code: ModeCode, stream: SavedStream | null) => {
      if (!isReady(modeStore)) return;
      // A7: another mode while paired asks first; the sheet's confirm opens it.
      if (asksBeforeOpening(code.mode, selectEngineStatus(engine.getSnapshot()))) {
        return setPanel({ kind: 'unpairConfirm', tapped: code.mode, code });
      }
      const saved = savedCodeFrom(code, clock(), stream);
      try {
        await modeStore.open(saved);
      } catch {
        return saveFailed('open');
      }
      setStatusKey(null);
      if (code.mode !== 'stream') return;
      navigation.go('stream');
      pair(saved, 'new');
    },
    [modeStore, clock, navigation, engine, pair, setStatusKey, saveFailed, setPanel],
  );
}

/**
 * A7's sheet. Confirm unpairs (`useUnpair('otherMode')`), forgets the stream
 * code once the engine is Idle, as the operator's Stop does (Process death and
 * reopen), then opens the other mode. A Go live that raced it holds the
 * broadcast: the code is kept and nothing opens. A refused forget is never
 * silent (R19): the line says so, and the other mode does not open. The sheet
 * closes as Cancel when the engine leaves Paired under it; a panel that
 * replaced it in the same moment (Task 29's unpair) is left standing.
 */
function useUnpairConfirm(
  panel: HomePanel | null,
  setPanel: SetPanel,
  openCode: OpenCode,
  saveFailed: SaveFailed,
): { confirm: () => void; cancel: () => void } {
  const { modeStore } = usePorts();
  const unpair = useUnpair();
  const status = useEngineSelector(selectEngineStatus);
  const open = panel?.kind === 'unpairConfirm' ? panel : null;
  useEffect(() => {
    if (open !== null && status !== 'paired') setPanel(closeSheet);
  }, [open, status, setPanel]);
  const confirm = useCallback(() => {
    if (open === null) return;
    setPanel(closeSheet);
    unpair('otherMode', (outcome) => {
      if (outcome === 'held') return;
      const code = savedStream(modeStore);
      const forgot = code === null ? Promise.resolve(true) : modeStore.forget(code);
      forgot
        .then(
          () => openCode(open.code, null),
          () => saveFailed('forget'),
        )
        .catch(ignoreUnexpected);
    });
  }, [open, setPanel, unpair, modeStore, openCode, saveFailed]);
  const cancel = useCallback(() => setPanel(null), [setPanel]);
  return { confirm, cancel };
}

/** Closes the sheet, and only the sheet: a panel that replaced it stays. */
const closeSheet = (open: HomePanel | null): HomePanel | null =>
  open?.kind === 'unpairConfirm' ? null : open;

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
 * Takes Ended's "Scan another" hand-off (D24) once the store is ready (R12),
 * and scans from the Live Stream tile, under the tile's own scan flight.
 */
function useScanRequest(ready: boolean, tapTile: (mode: Mode) => void): void {
  const { homeIntent } = usePorts();
  useEffect(() => {
    if (ready && homeIntent.takeScan()) tapTile('stream');
  }, [ready, homeIntent, tapTile]);
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
  const continueCopy = useContinueCopy(continueCode);
  return {
    statusText: statusText(ready, statusKey, t, format),
    panel,
    panelTime,
    continueCode,
    continueCopy,
  };
}

/**
 * The Continue card's words (amendment §2, Home), from the engine's status
 * and the held name as primitives (Task 23's selectors), so a 1 Hz snapshot
 * that changes none of them changes nothing.
 */
function useContinueCopy(code: SavedCode | null): ContinueCopy | null {
  const format = useFormatTime();
  const engine = useEngineSelector(selectEngineStatus);
  const pairing = useEngineSelector(selectStateKind) === 'pairing';
  const heldCode = useEngineSelector(selectHeldCode);
  const heldSlot = useEngineSelector(selectHeldSlot);
  const heldTag = useEngineSelector(selectHeldTokenTag);
  const heldLabel = useEngineSelector(selectLabel);
  if (code === null) return null;
  const held = { code: heldCode, slot: heldSlot, tokenTag: heldTag };
  const validTill = code.expiresAt === null ? null : format(code.expiresAt, venueZone(code));
  return continueCard({ pairing, saved: code, engine, held, heldLabel, validTill });
}

/**
 * The unpair Home last named, per engine (review C5 m-11): kept across Home's
 * own remounts, as `useUnpair`'s clearings are, so a panel already shown or
 * closed does not come back when Home mounts again. Keyed by the engine, which
 * is built once with the ports, so a test's engine never meets another's.
 */
const named = new WeakMap<CaptureEnginePort, string>();

/**
 * PV31: native's next pair clears the unpair, and the memory with it, whether
 * Home is mounted or not (a scan pairs from /stream, with Home gone).
 */
function rememberNamed(engine: CaptureEnginePort, key: string): void {
  named.set(engine, key);
  const unsubscribe = engine.subscribe(() => {
    if (engine.getSnapshot().unpaired !== null) return;
    named.delete(engine);
    unsubscribe();
  });
}

/**
 * Amendment §2, Unpaired without asking: Home names why, once per unpair.
 * `unpaired` is a new object on every snapshot, so it is compared by value
 * (`selectUnpairedKey`); the one named is remembered (`rememberNamed`), so the
 * same code unpaired again after a pair says so again. A scan in flight keeps its "Checking code…" panel; the unpair
 * panel follows it on the next change.
 */
function useUnpairedPanel(panel: HomePanel | null, setPanel: SetPanel): void {
  const { engine } = usePorts();
  const key = useEngineSelector(selectUnpairedKey);
  // The same snapshot's reason, as its own primitive: no parse of the key, no cast.
  const reason = useEngineSelector(selectUnpairedReason);
  useEffect(() => {
    if (key === null || reason === null) return;
    if (key === named.get(engine) || panel?.kind === 'checking') return;
    rememberNamed(engine, key);
    setPanel({ kind: 'unpaired', tapped: 'stream', reason });
  }, [engine, key, reason, panel, setPanel]);
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
 * The Continue button: makes the code active, opens Live Stream, and pairs by
 * the identity rules (the same code paired is adopted). The card renders only
 * from a `ready` snapshot (R12).
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
  const pair = usePairing();
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
          pair(code, 'new');
        },
        () => saveFailed('continue'),
      )
      .catch(ignoreUnexpected);
  }, [modeStore, navigation, clock, logger, pair, setStatusKey, saveFailed]);
}

/**
 * The Forget button: immediate, with no confirmation (spec §4). I1 (final
 * review, owner-visible): the code's pairing goes with it, paired or ended,
 * so nothing is left to reopen or go live on. The amendment (Identity rules
 * in JS): unpair first, and forget the code once the engine is Idle. If a
 * remote Go live raced the tap, the broadcast stands, the code is kept, and
 * the route rule shows /stream. A give-up (CD26) forgets: the operator asked,
 * and an engine still paired is then an orphan, unpaired at the next settle.
 * A refused forget keeps the code, with the engine already Idle.
 *
 * I1 (never a viewfinder for a forgotten code): a foreground before native
 * answers reopens /stream on the still-paired code, which unmounts Home and
 * ends the unpair as a give-up. The forget then lands Home again.
 */
function useForget(setStatusKey: SetStatusKey, saveFailed: SaveFailed): () => void {
  const { modeStore, navigation } = usePorts();
  const unpair = useUnpair();
  return useCallback(() => {
    // C4b-I2: the code on the card when Forget was pressed. A code scanned
    // before the unpair ends is a new scan, which the forget leaves, and Home
    // does not follow it Home.
    const code = savedStream(modeStore);
    if (code === null) return;
    unpair('forget', (outcome) => {
      if (outcome === 'held') return;
      void modeStore.forget(code).then(
        (forgot) => {
          if (!forgot) return;
          setStatusKey(null);
          navigation.go('home');
        },
        () => saveFailed('forget'),
      );
    });
  }, [modeStore, navigation, setStatusKey, saveFailed, unpair]);
}

/**
 * Development builds only: a pasted code goes where a Live Stream scan would,
 * under a scan flight of its own as Try again is, so a second press or a tile
 * tap cannot start a second check.
 */
function usePaste(handle: HandleScan): (raw: string) => void {
  const { devTools, scanFlight } = usePorts();
  return useCallback(
    (raw: string) => {
      if (!devTools || !scanFlight.begin()) return;
      void handle('stream', { outcome: 'scanned', raw })
        .catch(ignoreUnexpected)
        .finally(() => scanFlight.end());
    },
    [devTools, scanFlight, handle],
  );
}
