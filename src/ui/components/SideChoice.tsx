import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import type { ControlSide, StreamSettings } from '@/services/streamSettingsStore';
import { Text } from '@/ui/components/Text';
import { layout as metrics, plateInk, colour, radius, space } from '@/ui/theme/tokens';

type Change = (next: Partial<StreamSettings>) => void;

/**
 * Controls on the left or the right (the owner's board): the label and, on the same line at its right, one outlined
 * pair of segments, the chosen one filled lime. Takes the screen's own `change`, so a refused save says so in the one
 * place the screen shows it.
 */
export function SideChoice({ side, change }: { side: ControlSide; change: Change }) {
  const { t } = useT();
  const label = t('settings.side.label');
  return (
    <View style={styles.side}>
      <Text variant="controlInk" style={styles.sideLabel}>
        {label}
      </Text>
      <SidePair side={side} change={change} label={label} />
    </View>
  );
}

/**
 * The pair on its own, for a row that draws the label itself (the app's Settings). A radiogroup named by `label`, each
 * segment a radio, named by `words` (the viewfinder Settings' "Left" and "Right" by default; the app's row passes its
 * own, shorter in Dutch, so the label and the pair share one line at 320 dp).
 */
export function SidePair({
  side,
  change,
  label,
  words,
}: {
  side: ControlSide;
  change: Change;
  label: string;
  words?: { readonly left: string; readonly right: string };
}) {
  const { t } = useT();
  const toLeft = useCallback(() => change({ side: 'left' }), [change]);
  const toRight = useCallback(() => change({ side: 'right' }), [change]);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.pair}>
      <Segment
        label={words?.left ?? t('settings.side.left')}
        checked={side === 'left'}
        onPress={toLeft}
      />
      <Segment
        label={words?.right ?? t('settings.side.right')}
        checked={side === 'right'}
        onPress={toRight}
      />
    </View>
  );
}

/** One segment of the pair: a radio, 48 dp tall; chosen, a lime fill with night ink (the plate rule, AGENTS §5). */
const Segment = memo(function Segment({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      // aria-checked, not accessibilityState, as ChoiceRow has it.
      aria-checked={checked}
      onPress={onPress}
      style={checked ? segmentOn : styles.segment}
    >
      <Text variant="control" style={checked ? styles.segmentTextOn : undefined}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  /** The label and the pair on one line, the pair at the right. */
  side: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sideLabel: { flex: 1 },
  /** One outlined box; clipping the segments inside it gives the lime fill the box's corners. */
  pair: {
    flexDirection: 'row',
    borderWidth: metrics.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  segment: {
    minHeight: metrics.touch,
    minWidth: metrics.segmentMin,
    paddingHorizontal: metrics.segmentPadX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: colour.lime },
  segmentTextOn: { color: plateInk },
});

const segmentOn = [styles.segment, styles.segmentOn];
