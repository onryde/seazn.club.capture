import { StyleSheet, View } from 'react-native';
import { cutDestination } from '@/domain/session/destination';
import { columnLineKey } from '@/hooks/statusKey';
import { useT } from '@/hooks/useLanguage';
import { usePeek } from '@/hooks/usePeek';
import { useEndedToHome } from '@/hooks/useEndedNotice';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamLinks } from '@/hooks/useStreamLinks';
import { useScoringLink } from '@/hooks/useScoringLink';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewfinder, type Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';

/**
 * Live Stream's viewfinder (spec §1, §4): Arm and on air are one screen, a
 * projection of the engine's state, in two equal halves. An Ended leaves it for
 * Home with the Stream ended card (spec §5). The camera half is
 * the shot with the status strip under it; the controls half is on the side the
 * operator picked in Settings, and Left mirrors the halves.
 */
export function StreamScreen() {
  const leave = useStreamLeave();
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  const peek = usePeek(view.peekable);
  useEndedToHome(leave.leaveWith);
  const links = useStreamLinks();
  const scoring = useScoringLink();
  const line = useColumnLine(view, leave.blocked);
  return (
    <View testID="viewfinder" style={settings.side === 'left' ? styles.mirrored : styles.halves}>
      <StreamStage
        line={line}
        paired={view.kind === 'paired'}
        overlayOn={settings.overlay}
        peek={peek}
        scoring={scoring.view}
        scoringSecondsLeft={scoring.secondsLeft}
        onHideScoring={scoring.hide}
      />
      <StreamColumn
        view={view}
        peek={peek}
        canLeave={leave.canLeave}
        onHome={leave.leave}
        onSettings={links.settings}
        onScoringLink={scoring.open}
        scoringOpen={scoring.view.kind !== 'hidden'}
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

const styles = StyleSheet.create({
  halves: { flex: 1, flexDirection: 'row' },
  mirrored: { flex: 1, flexDirection: 'row-reverse' },
});
