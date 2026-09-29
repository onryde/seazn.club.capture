import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { Mode, ModeCode } from '@/domain/mode/Mode';
import { recognise } from '@/domain/mode/recognise';
import { isExpired, savedCodeFrom, type SavedCode } from '@/domain/mode/savedCode';
import { scanOutcome, type ScanOutcome } from '@/domain/mode/scanOutcome';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import type { CodeScannerPort, ScanResult, ScanUnavailableReason } from '@/scanner/CodeScannerPort';
import type { ModeStore, ModeStoreSnapshot } from '@/services/modeStore';

type PanelOutcome = Exclude<ScanOutcome, { kind: 'open' }>;

export type HomeView = {
  readonly statusText: string;
  readonly panel: PanelOutcome | null;
  readonly panelTime: string | null;
  readonly continueCode: SavedCode | null;
  readonly continueTill: string | null;
};

export type HomeActions = {
  tapTile(mode: Mode): void;
  scanAgain(): void;
  openFromPanel(code: ModeCode): void;
  closePanel(): void;
  continueStream(): void;
  forgetStream(): void;
  /** Development builds only: a pasted code, handled as if scanned from Live Stream. */
  useRaw(raw: string): void;
};

type SetPanel = (panel: PanelOutcome | null) => void;
type SetScannerKey = (key: MessageKey | null) => void;
type ReadyStore = Extract<ModeStoreSnapshot, { status: 'ready' }>;

const SCANNER_MESSAGE: Readonly<Record<ScanUnavailableReason, MessageKey>> = {
  noPlayServices: 'scanner.noPlayServices',
  installing: 'scanner.installing',
  failed: 'scanner.failed',
};

const DID_NOT_OPEN: ScanResult = { outcome: 'unavailable', reason: 'failed' };

/**
 * Ruling R12: the store takes writes only once it is `ready`. Read at call
 * time, not from a render, so a tap never acts on a stale snapshot.
 */
function isReady(store: ModeStore): boolean {
  return store.getSnapshot().status === 'ready';
}

/** A write that failed changes nothing: the store publishes only after storage agrees. */
function ignoreFailedWrite(): void {}

/**
 * Home's behaviour (spec §3): tap, scan, recognise, then open or explain.
 */
export function useHome(): { view: HomeView; actions: HomeActions } {
  const { modeStore } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const [panel, setPanel] = useState<PanelOutcome | null>(null);
  const [scannerKey, setScannerKey] = useState<MessageKey | null>(null);
  const openCode = useOpenCode();
  const handle = useHandleScan(openCode, setPanel, setScannerKey);
  const tapTile = useTapTile(handle, setPanel, setScannerKey);
  const view = useHomeView(snapshot, panel, scannerKey);
  const panelActions = usePanelActions(panel, tapTile, openCode, setPanel);
  const continueActions = useContinueActions();
  const pasteRaw = usePaste(handle);
  return { view, actions: { tapTile, ...panelActions, ...continueActions, useRaw: pasteRaw } };
}

/**
 * Save the code and make it active, then open its mode. A code that could not
 * be saved is not opened: the stream screen reads it back from the store.
 */
function useOpenCode(): (code: ModeCode) => void {
  const { modeStore, clock, navigation } = usePorts();
  return useCallback(
    (code: ModeCode) => {
      if (!isReady(modeStore)) return;
      void modeStore.open(savedCodeFrom(code, clock())).then(() => {
        if (code.mode === 'stream') navigation.go('stream');
      }, ignoreFailedWrite);
    },
    [modeStore, clock, navigation],
  );
}

/** One scan's result: nothing, a reason on the status line, an open, or a panel. */
function useHandleScan(
  openCode: (code: ModeCode) => void,
  setPanel: SetPanel,
  setScannerKey: SetScannerKey,
): (tapped: Mode, result: ScanResult) => void {
  const { clock, hosts } = usePorts();
  return useCallback(
    (tapped: Mode, result: ScanResult) => {
      if (result.outcome === 'cancelled') return;
      if (result.outcome === 'unavailable') return setScannerKey(SCANNER_MESSAGE[result.reason]);
      const outcome = scanOutcome(tapped, recognise(result.raw, clock(), hosts));
      if (outcome.kind === 'open') openCode(outcome.code);
      else setPanel(outcome);
    },
    [clock, hosts, openCode, setPanel, setScannerKey],
  );
}

/**
 * One scan at a time. A second native `startScan()` cancels the first, or
 * fails with status 204 (Task 8), so taps while the scanner is up are ignored.
 * The guard is released on every outcome, a broken scanner included, so Home
 * can never be left with no way to scan.
 */
function useTapTile(
  handle: (tapped: Mode, result: ScanResult) => void,
  setPanel: SetPanel,
  setScannerKey: SetScannerKey,
): (mode: Mode) => void {
  const { modeStore, scanner } = usePorts();
  const scanning = useRef(false);
  return useCallback(
    (mode: Mode) => {
      if (scanning.current) return;
      if (!isReady(modeStore)) return;
      scanning.current = true;
      setPanel(null);
      setScannerKey(null);
      modeStore.dismissNotices();
      void scanSafely(scanner)
        .then((result) => handle(mode, result))
        .finally(() => {
          scanning.current = false;
        });
    },
    [modeStore, scanner, handle, setPanel, setScannerKey],
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
  panel: PanelOutcome | null,
  scannerKey: MessageKey | null,
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
    statusText: statusText(ready, scannerKey, t, format),
    panel,
    panelTime,
    continueCode,
    continueTill: continueCode?.expiresAt
      ? format(continueCode.expiresAt, continueCode.venueTz)
      : null,
  };
}

/** What the one status line says, most important first (AGENTS §6: always something true). */
function statusText(
  ready: ReadyStore | null,
  scannerKey: MessageKey | null,
  t: Translator['t'],
  format: (at: Date, zone: string | null) => string,
): string {
  const notice = ready?.notice ?? null;
  if (notice !== null) {
    const mode = t(MODE_NAME[notice.mode]);
    return t('reopen.expired', { mode, time: format(notice.expiredAt, null) });
  }
  if (ready?.dropped) return t('store.unreadable');
  if (scannerKey !== null) return t(scannerKey);
  return t('home.status.idle');
}

/** The panel's buttons: open the code it named, scan again from the same tile, or close. */
function usePanelActions(
  panel: PanelOutcome | null,
  tapTile: (mode: Mode) => void,
  openCode: (code: ModeCode) => void,
  setPanel: SetPanel,
): Pick<HomeActions, 'scanAgain' | 'openFromPanel' | 'closePanel'> {
  const scanAgain = useCallback(() => {
    if (panel !== null) tapTile(panel.tapped);
  }, [panel, tapTile]);
  const openFromPanel = useCallback(
    (code: ModeCode) => {
      setPanel(null);
      openCode(code);
    },
    [openCode, setPanel],
  );
  const closePanel = useCallback(() => setPanel(null), [setPanel]);
  return { scanAgain, openFromPanel, closePanel };
}

/**
 * The Continue card's two buttons; Forget is immediate, with no confirmation
 * (spec §4). No ready check here: the card renders only from a `ready`
 * snapshot, so neither button exists before the store has loaded (R12).
 */
function useContinueActions(): Pick<HomeActions, 'continueStream' | 'forgetStream'> {
  const { modeStore, navigation } = usePorts();
  const continueStream = useCallback(() => {
    void modeStore.setActive('stream').then(() => navigation.go('stream'), ignoreFailedWrite);
  }, [modeStore, navigation]);
  const forgetStream = useCallback(() => {
    void modeStore.forget('stream').catch(ignoreFailedWrite);
  }, [modeStore]);
  return { continueStream, forgetStream };
}

/** Development builds only: a pasted code goes where a Live Stream scan would. */
function usePaste(handle: (tapped: Mode, result: ScanResult) => void): (raw: string) => void {
  const { devTools } = usePorts();
  return useCallback(
    (raw: string) => {
      if (devTools) handle('stream', { outcome: 'scanned', raw });
    },
    [devTools, handle],
  );
}
