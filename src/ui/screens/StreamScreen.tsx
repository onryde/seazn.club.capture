import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePeek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';
import { colour } from '@/ui/theme/tokens';

/**
 * Live Stream's viewfinder (spec §4): Arm, on air and Ended are one screen,
 * a projection of the engine's state. The column sits on the side the
 * operator picked in Settings.
 */
export function StreamScreen() {
  const leave = useStreamLeave();
  const view = useViewfinder(leave.departed);
  const { settings } = useStreamSettings();
  const peek = usePeek(view.peekable);
  const scanAnother = useScanAnother(leave.leave);
  return (
    <View style={settings.side === 'left' ? styles.columnLeft : styles.columnRight}>
      <StreamStage
        armed={view.kind === 'armed'}
        overlayOn={settings.overlay}
        peek={peek}
        canLeave={leave.canLeave}
        onHome={leave.leave}
      />
      <StreamColumn view={view} blocked={leave.blocked} peek={peek} onScanAnother={scanAnother} />
    </View>
  );
}

/**
 * Ended's Scan another (D24): ask Home to scan, then leave. Only Home calls
 * `scan()`; the leave is one at a time (useLeaveOnce), so a double press
 * leaves once, and a second request before Home takes the first is one scan.
 */
function useScanAnother(leave: () => void): () => void {
  const { homeIntent } = usePorts();
  return useCallback(() => {
    homeIntent.requestScan();
    leave();
  }, [homeIntent, leave]);
}

const styles = StyleSheet.create({
  columnRight: { flex: 1, flexDirection: 'row', backgroundColor: colour.ground },
  columnLeft: { flex: 1, flexDirection: 'row-reverse', backgroundColor: colour.ground },
});
