import { StyleSheet, View } from 'react-native';
import { cutDestination } from '@/domain/session/destination';
import { columnLineKey, LINE_TIER, type LineTier } from '@/hooks/statusKey';
import { useT } from '@/hooks/useLanguage';
import { useEndedToHome } from '@/hooks/useEndedNotice';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamLinks } from '@/hooks/useStreamLinks';
import { useScoringLink } from '@/hooks/useScoringLink';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewerCheck } from '@/hooks/useViewerCheck';
import { useViewfinder, type Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';

/**
 * Live Stream's viewfinder (spec §1, §4): Arm and on air are one screen, a
 * projection of the engine's state, in two halves. An Ended leaves it for
 * Home with the Stream ended card (spec §5). The camera half is
 * the shot with the status strip under it; the controls half is on the side the
 * operator picked in Settings, and Left mirrors the halves. They are not equal
 * (owner, 2026-10-08): the controls half is the fixed width its widest row needs
 * (`layout.controlsHalf`, set where the half is drawn, in `StreamColumn`) and the
 * camera half (`flex: 1`, in `StreamStage`) is everything else, on either side.
 */
export function StreamScreen() {
  const leave = useStreamLeave();
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  useEndedToHome(leave.leaveWith);
  const links = useStreamLinks();
  const scoring = useScoringLink(view.plate === 'trouble');
  const scoringOpen = scoring.view.kind !== 'hidden';
  // D2 §4.3: one cover at a time. Opening the view takes the panel down; the panel opening closes the view.
  const viewer = useViewerCheck({
    available: view.peekable,
    shed: view.shed,
    scoringOpen,
    hideScoring: scoring.hide,
  });
  const line = useColumnLine(view, leave.blocked);
  return (
    <View testID="viewfinder" style={settings.side === 'left' ? styles.mirrored : styles.halves}>
      <StreamStage
        line={line.text}
        lineTier={line.tier}
        viewer={viewer}
        scoring={scoring.view}
        scoringSecondsLeft={scoring.secondsLeft}
        onHideScoring={scoring.hide}
      />
      <StreamColumn
        view={view}
        viewer={viewer}
        canLeave={leave.canLeave}
        onHome={leave.leave}
        onSettings={links.settings}
        onScoringLink={scoring.open}
        scoringOpen={scoringOpen}
      />
    </View>
  );
}

/**
 * The one true sentence: the status line, or Back's refusal over a calm one
 * (ruling I2), with its tier (`LINE_TIER`: an urgent line always wins the strip's one
 * message line, a routine one gives way to a caption). `{destination}` is cut at 24, the
 * width every budget counts. It is said in the status strip, under the shot, and made here once.
 */
function useColumnLine(view: Viewfinder, blocked: boolean): { text: string; tier: LineTier } {
  const { t } = useT();
  const vars = {
    remaining: view.holdRemaining ?? '',
    window: view.holdWindow ?? '',
    destination: view.destination === null ? '' : cutDestination(view.destination),
  };
  const key = columnLineKey(view.statusKey, blocked);
  return { text: t(key, vars), tier: LINE_TIER[key] };
}

const styles = StyleSheet.create({
  halves: { flex: 1, flexDirection: 'row' },
  mirrored: { flex: 1, flexDirection: 'row-reverse' },
});
