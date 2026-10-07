import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { cutDestination } from '@/domain/session/destination';
import { columnLineKey } from '@/hooks/statusKey';
import { useT } from '@/hooks/useLanguage';
import { usePeek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamLinks } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewfinder, type Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';

/**
 * Live Stream's viewfinder (spec §1, §4): Arm, on air and Ended are one screen,
 * a projection of the engine's state, in two equal halves. The camera half is
 * the shot with the status strip under it; the controls half is on the side the
 * operator picked in Settings, and Left mirrors the halves.
 */
export function StreamScreen() {
  const leave = useStreamLeave();
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  const peek = usePeek(view.peekable);
  const scanAnother = useScanAnother(leave.leaveWith);
  const links = useStreamLinks();
  const line = useColumnLine(view, leave.blocked);
  return (
    <View testID="viewfinder" style={settings.side === 'left' ? styles.mirrored : styles.halves}>
      <StreamStage
        line={line}
        paired={view.kind === 'paired'}
        overlayOn={settings.overlay}
        peek={peek}
      />
      <StreamColumn
        view={view}
        peek={peek}
        canLeave={leave.canLeave}
        onHome={leave.leave}
        onSettings={links.settings}
        onDiagnostics={links.diagnostics}
        onScanAnother={scanAnother}
      />
    </View>
  );
}

/**
 * The one true sentence: the status line, or Back's refusal over a calm one
 * (ruling I2). `{destination}` is cut at 24, the width every budget counts.
 * It is said in the status strip, under the shot, and made here once.
 */
function useColumnLine(view: Viewfinder, blocked: boolean): string {
  const { t } = useT();
  const vars = {
    remaining: view.holdRemaining ?? '',
    window: view.holdWindow ?? '',
    destination: view.destination === null ? '' : cutDestination(view.destination),
  };
  return t(columnLineKey(view.statusKey, blocked), vars);
}

/**
 * Ended's Scan another (D24): leave, asking Home to scan on the way. Only Home
 * calls `scan()`. The request is made only by a leave that goes Home (M9), so
 * a leave cancelled on air leaves nothing waiting for the next Home. The leave
 * is one at a time (useLeaveOnce), so a double press leaves and asks once.
 */
function useScanAnother(leaveWith: (beforeHome: () => void) => void): () => void {
  const { homeIntent } = usePorts();
  return useCallback(() => leaveWith(homeIntent.requestScan), [homeIntent, leaveWith]);
}

const styles = StyleSheet.create({
  halves: { flex: 1, flexDirection: 'row' },
  mirrored: { flex: 1, flexDirection: 'row-reverse' },
});
