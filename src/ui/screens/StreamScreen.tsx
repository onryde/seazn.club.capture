import { StyleSheet, View } from 'react-native';
import { cutDestination } from '@/domain/session/destination';
import { columnLineKey, LINE_TIER, type LineTier } from '@/hooks/statusKey';
import { useT } from '@/hooks/useLanguage';
import { useEndedToHome } from '@/hooks/useEndedNotice';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamLinks } from '@/hooks/useStreamLinks';
import { useScoringLink } from '@/hooks/useScoringLink';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewerCheck, type ViewerCheckView } from '@/hooks/useViewerCheck';
import { useViewfinder, type Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';
import { FEATURES } from '@/ui/features';

type ScreenProps = {
  /**
   * What viewers see is built in (D2 §4.3). Left out, as the route leaves it, it is the shipped switch,
   * `FEATURES.viewerCheck`: off, by the owner's ruling of 2026-10-09. The tests of the hidden feature pass true.
   */
  readonly viewerCheck?: boolean;
};

/**
 * Live Stream's viewfinder (spec §1, §4): Arm and on air are one screen, a
 * projection of the engine's state, in two halves. An Ended leaves it for
 * Home with the Stream ended card (spec §5). The camera half is
 * the shot with the status strip under it; the controls half is on the side the
 * operator picked in Settings, and Left mirrors the halves. They are not equal
 * (owner, 2026-10-08): the controls half is the fixed width its widest row needs
 * (`layout.controlsHalf`, set where the half is drawn, in `StreamColumn`) and the
 * camera half (`flex: 1`, in `StreamStage`) is everything else, on either side.
 * With What viewers see hidden the halves get no viewer, and nothing of the view mounts.
 */
export function StreamScreen({ viewerCheck = FEATURES.viewerCheck }: ScreenProps) {
  const leave = useStreamLeave();
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  useEndedToHome(leave.leaveWith);
  const links = useStreamLinks();
  const scoring = useScoringLink(view.plate === 'trouble');
  const line = useColumnLine(view, leave.blocked);
  const halves: HalvesProps = {
    view,
    line,
    scoring,
    mirrored: settings.side === 'left',
    canLeave: leave.canLeave,
    onHome: leave.leave,
    onSettings: links.settings,
  };
  return viewerCheck ? <HalvesWithViewer {...halves} /> : <Halves {...halves} viewer={null} />;
}

type HalvesProps = {
  readonly view: Viewfinder;
  readonly line: ColumnLine;
  readonly scoring: ReturnType<typeof useScoringLink>;
  /** The controls on the left (Settings): the halves mirrored. */
  readonly mirrored: boolean;
  readonly canLeave: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
};

/**
 * What viewers see built in (D2 §4.3), so its hook runs here and only here: with the switch off this component is
 * never drawn. One cover at a time: opening the view takes the panel down; the panel opening closes the view.
 */
function HalvesWithViewer(props: HalvesProps) {
  const viewer = useViewerCheck({
    available: props.view.peekable,
    shed: props.view.shed,
    scoringOpen: props.scoring.view.kind !== 'hidden',
    hideScoring: props.scoring.hide,
  });
  return <Halves {...props} viewer={viewer} />;
}

/** The camera half and the controls half. `viewer` is null with What viewers see hidden (`FEATURES.viewerCheck`). */
function Halves(props: HalvesProps & { readonly viewer: ViewerCheckView | null }) {
  const { view, line, scoring, viewer } = props;
  return (
    <View testID="viewfinder" style={props.mirrored ? styles.mirrored : styles.halves}>
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
        canLeave={props.canLeave}
        onHome={props.onHome}
        onSettings={props.onSettings}
        onScoringLink={scoring.open}
        scoringOpen={scoring.view.kind !== 'hidden'}
      />
    </View>
  );
}

type ColumnLine = { readonly text: string; readonly tier: LineTier };

/**
 * The one true sentence: the status line, or Back's refusal over a calm one
 * (ruling I2), with its tier (`LINE_TIER`: an urgent line always wins the strip's one
 * message line, a routine one gives way to a caption). `{destination}` is cut at 24, the
 * width every budget counts. It is said in the status strip, under the shot, and made here once.
 */
function useColumnLine(view: Viewfinder, blocked: boolean): ColumnLine {
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
