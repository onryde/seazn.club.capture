import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { columnLineKey } from '@/hooks/statusKey';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import type { BlockerKey } from '@/hooks/preflight';
import type { Viewfinder, ViewfinderAction } from '@/hooks/useViewfinder';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { EndedBlock } from '@/ui/components/EndedBlock';
import { HoldAction } from '@/ui/components/HoldAction';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { StatusLine } from '@/ui/components/StatusLine';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour, layout, space } from '@/ui/theme/tokens';

type ColumnProps = {
  readonly view: Viewfinder;
  readonly blocked: boolean;
  readonly peek: Peek;
  /** Ended's Scan another (D24). */
  readonly onScanAnother: () => void;
};

/**
 * The side column (spec §4), top to bottom: state plate, elapsed, meter, the
 * one true sentence, then the pre-flight or the peek, then the action.
 */
export const StreamColumn = memo(function StreamColumn(props: ColumnProps) {
  const { view, peek } = props;
  const line = useColumnLine(view, props.blocked);
  return (
    <View style={styles.column}>
      <TallyPlate plate={view.plate} />
      <Elapsed />
      <AudioMeter />
      <StatusLine>{line}</StatusLine>
      {view.action === 'goLive' ? (
        <PreflightChips preflight={view.preflight} goLiveBy={view.goLiveBy} />
      ) : null}
      <ColumnPeek onAir={view.onAir} peekable={view.peekable} peek={peek} />
      <ColumnAction
        action={view.action}
        goLiveOff={view.kind !== 'armed' || view.blocker !== null}
        reason={view.kind === 'armed' ? view.reason : null}
        start={view.start}
        stop={view.stop}
        onScanAnother={props.onScanAnother}
      />
    </View>
  );
});

/** The one true sentence: the status line, or Back's refusal over a calm one (ruling I2). */
function useColumnLine(view: Viewfinder, blocked: boolean): string {
  const { t } = useT();
  const vars = { remaining: view.holdRemaining ?? '', window: view.holdWindow ?? '' };
  return t(columnLineKey(view.statusKey, blocked), vars);
}

type PeekProps = { readonly onAir: boolean; readonly peekable: boolean; readonly peek: Peek };

/**
 * What viewers see, on air only; off, with its reason, when there is no
 * picture (carry 13). Primitives, not the view, so memo skips (M7).
 */
const ColumnPeek = memo(function ColumnPeek({ onAir, peekable, peek }: PeekProps) {
  const { t } = useT();
  if (!onAir) return null;
  return (
    <ViewerPeek
      disabled={!peekable}
      reason={peekable ? null : t('stream.peek.unavailable')}
      onPressIn={peek.pressIn}
      onPressOut={peek.pressOut}
    />
  );
});

type ActionProps = {
  readonly action: ViewfinderAction;
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
      tone={stop ? 'stop' : 'go'}
      disabled={!stop && props.goLiveOff}
      reason={props.reason === null ? null : t(props.reason)}
      onHeld={stop ? props.stop : props.start}
    />
  );
});

const styles = StyleSheet.create({
  column: {
    width: layout.columnWidth,
    gap: space.sm,
    padding: space.sm,
    backgroundColor: colour.ground,
  },
});
