import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Chip } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import type { Viewfinder } from '@/hooks/useViewfinder';
import type { MessageKey } from '@/i18n/messages';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { HoldAction } from '@/ui/components/HoldAction';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { StatusLine } from '@/ui/components/StatusLine';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour, layout, space } from '@/ui/theme/tokens';

const BLOCKER_KEY: Readonly<Record<Chip, MessageKey>> = {
  code: 'stream.blocker.code',
  camera: 'stream.blocker.camera',
  network: 'stream.blocker.network',
  sound: 'stream.blocker.sound',
};

type ColumnProps = { readonly view: Viewfinder; readonly blocked: boolean; readonly peek: Peek };

/**
 * The side column (spec §4), top to bottom: state plate, elapsed, meter, the
 * one true sentence, then the pre-flight or the peek, then the action.
 */
export const StreamColumn = memo(function StreamColumn({ view, blocked, peek }: ColumnProps) {
  const { t } = useT();
  const vars = { remaining: view.holdRemaining ?? '', window: view.holdWindow ?? '' };
  const line = blocked ? t('stream.leaveOnAir') : t(view.statusKey, vars);
  return (
    <View style={styles.column}>
      <TallyPlate plate={view.plate} />
      <Elapsed />
      <AudioMeter />
      <StatusLine>{line}</StatusLine>
      {view.action === 'goLive' ? (
        <PreflightChips preflight={view.preflight} goLiveBy={view.goLiveBy} />
      ) : null}
      <ColumnPeek view={view} peek={peek} />
      <ColumnAction view={view} />
    </View>
  );
});

/** What viewers see, on air only; off, with its reason, when there is no picture (carry 13). */
const ColumnPeek = memo(function ColumnPeek({ view, peek }: { view: Viewfinder; peek: Peek }) {
  const { t } = useT();
  if (!view.onAir) return null;
  return (
    <ViewerPeek
      disabled={!view.peekable}
      reason={view.peekable ? null : t('stream.peek.unavailable')}
      onPressIn={peek.pressIn}
      onPressOut={peek.pressOut}
    />
  );
});

/**
 * Go live before air, Stop on it; after it, nothing here yet. Go live says
 * why it is off only once armed: before that the plate and line already do.
 * Keyed by the action (carry 13): a hold belongs to the control the finger
 * landed on, so Go live turning into Stop under it abandons it, while a
 * change of state that keeps Stop keeps the hold.
 */
const ColumnAction = memo(function ColumnAction({ view }: { view: Viewfinder }) {
  const { t } = useT();
  if (view.action === 'ended') return null;
  const stop = view.action === 'stop';
  const armedBlocker = view.kind === 'armed' ? view.blocker : null;
  return (
    <HoldAction
      key={view.action}
      label={t(stop ? 'stream.action.stop' : 'stream.action.goLive')}
      tone={stop ? 'stop' : 'go'}
      disabled={!stop && (view.kind !== 'armed' || view.blocker !== null)}
      reason={!stop && armedBlocker !== null ? t(BLOCKER_KEY[armedBlocker]) : null}
      onHeld={stop ? view.stop : view.start}
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
