import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import type { BlockerKey } from '@/hooks/preflight';
import type { Viewfinder, ViewfinderAction } from '@/hooks/useViewfinder';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { EndedBlock } from '@/ui/components/EndedBlock';
import { HoldAction } from '@/ui/components/HoldAction';
import { IconButton } from '@/ui/components/IconButton';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour, layout, space } from '@/ui/theme/tokens';

type ColumnProps = {
  readonly view: Viewfinder;
  readonly peek: Peek;
  readonly canLeave: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
  /** Ended's Scan another (D24). */
  readonly onScanAnother: () => void;
};

/**
 * The controls half (spec §1), top to bottom: the tally plate with the timer
 * (on air) or the sound meter (before air), the readiness chips and the start
 * line (before air), the meter (on air), a flexible gap, the icon row, then the
 * action. The status line is the strip's, under the shot.
 */
export const StreamColumn = memo(function StreamColumn(props: ColumnProps) {
  const { view, peek } = props;
  return (
    <View testID="controls-half" style={styles.half}>
      <View testID="plate-row" style={styles.plateRow}>
        {/* A cell each, sharing the row: the meter has no width of its own to claim one. */}
        <View style={styles.cell}>
          <TallyPlate plate={view.plate} />
        </View>
        <View style={styles.cell}>{view.onAir ? <Elapsed /> : <AudioMeter />}</View>
      </View>
      {view.onAir ? <AudioMeter /> : null}
      {view.action === 'goLive' ? (
        <PreflightChips preflight={view.preflight} auto={view.auto} startsAt={view.startsAt} />
      ) : null}
      <View testID="controls-gap" style={styles.gap} />
      <IconRow
        onAir={view.onAir}
        peekable={view.peekable}
        peek={peek}
        canLeave={props.canLeave}
        onHome={props.onHome}
        onSettings={props.onSettings}
      />
      <ColumnAction
        action={view.action}
        stopUnpairs={view.stopUnpairs}
        goLiveOff={view.kind !== 'paired' || view.blocker !== null}
        reason={view.kind === 'paired' ? view.reason : null}
        start={view.start}
        stop={view.stop}
        onScanAnother={props.onScanAnother}
      />
    </View>
  );
});

type IconRowProps = PeekProps & {
  readonly canLeave: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
};

/**
 * The icon row (spec §3), 48 dp buttons: Settings in every state, live
 * included (AGENTS §6), then Home whenever leaving is allowed (never on air),
 * and on air What viewers see after Settings. Diagnostics is Settings' (§6).
 * Primitives and stable handlers, so memo skips (M7).
 */
const IconRow = memo(function IconRow(props: IconRowProps) {
  const { t } = useT();
  return (
    <View testID="icon-row" style={styles.iconRow}>
      <IconButton glyph="settings" label={t('stream.link.settings')} onPress={props.onSettings} />
      <ColumnPeek onAir={props.onAir} peekable={props.peekable} peek={props.peek} />
      {props.canLeave ? (
        <IconButton glyph="home" label={t('stream.home')} onPress={props.onHome} />
      ) : null}
    </View>
  );
});

type PeekProps = { readonly onAir: boolean; readonly peekable: boolean; readonly peek: Peek };

/**
 * What viewers see, on air only, and the row's remaining width; off, with its
 * reason, when there is no picture (carry 13). Primitives, not the view, so
 * memo skips (M7).
 */
const ColumnPeek = memo(function ColumnPeek({ onAir, peekable, peek }: PeekProps) {
  const { t } = useT();
  if (!onAir) return null;
  return (
    <View testID="peek-cell" style={styles.peekCell}>
      <ViewerPeek
        disabled={!peekable}
        reason={peekable ? null : t('stream.peek.unavailable')}
        onPressIn={peek.pressIn}
        onPressOut={peek.pressOut}
      />
    </View>
  );
});

type ActionProps = {
  readonly action: ViewfinderAction;
  /** Stop ends the pairing too (live); before the first frame it ends the broadcast only (owner decision 1). */
  readonly stopUnpairs: boolean;
  /** Go live is off: before the engine is armed, or with a chip off. */
  readonly goLiveOff: boolean;
  /**
   * Why Go live is off, given only while armed (ruling I3): before that the
   * plate and line already say, and an armed engine never shows Stop.
   */
  readonly reason: BlockerKey | null;
  readonly start: () => void;
  readonly stop: () => void;
  readonly onScanAnother: () => void;
};

/**
 * Go live before air, Stop on it; after it, Ended's summary and Scan another.
 * Keyed by the action (carry 13): a hold belongs to the control the finger
 * landed on, so Go live turning into Stop under it abandons it, while a
 * change of state that keeps Stop keeps the hold. Primitives, so memo skips (M7).
 */
const ColumnAction = memo(function ColumnAction(props: ActionProps) {
  const { t } = useT();
  if (props.action === 'ended') return <EndedBlock onScanAnother={props.onScanAnother} />;
  const stop = props.action === 'stop';
  return (
    <HoldAction
      key={props.action}
      label={t(stop ? 'stream.action.stop' : 'stream.action.goLive')}
      // A3: Stop ends the broadcast and, once live, the pairing, and says which to a screen reader (owner decision 1).
      a11yLabel={
        stop
          ? t(props.stopUnpairs ? 'stream.action.stopUnpairLabel' : 'stream.action.stopLabel')
          : undefined
      }
      tone={stop ? 'stop' : 'go'}
      disabled={!stop && props.goLiveOff}
      reason={props.reason === null ? null : t(props.reason)}
      onHeld={stop ? props.stop : props.start}
    />
  );
});

const styles = StyleSheet.create({
  half: {
    flex: 1,
    gap: layout.controlsGap,
    padding: layout.controlsPad,
    backgroundColor: colour.ground,
  },
  plateRow: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1, justifyContent: 'center' },
  gap: { flex: 1 },
  iconRow: { flexDirection: 'row', gap: space.sm },
  peekCell: { flex: 1 },
});
