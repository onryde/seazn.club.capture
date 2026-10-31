import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import type { PadHalf, PadSide } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

type ScoreHalfProps = {
  readonly half: PadHalf<MessageKey>;
  readonly onTap: (side: PadSide) => void;
};

/**
 * One side's half of the pad (layout A, owner 2026-10-31): the whole half is the button that gives that side the
 * rally, far larger than any other target. The names as typed, the big value in the LED lime, the games line, and the
 * serving plate. A screen reader reads the side, the value, the line and Serving as one name, and the hint says what a
 * tap does. A half that takes no tap (a card is up, a match is over) is disabled and draws the same.
 */
export const ScoreHalf = memo(function ScoreHalf({ half, onTap }: ScoreHalfProps) {
  const { t } = useT();
  const words = usePadText();
  const tap = useCallback(() => onTap(half.side), [onTap, half.side]);
  const sub = half.sub === null ? null : words(half.sub);
  const serving = half.serving ? t('scoring.pad.serving') : null;
  const name = [half.label, half.value, sub, serving].filter(isWords).join(', ');
  return (
    <Pressable
      testID={`half-${half.side}`}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={words(half.hint)}
      disabled={!half.tappable}
      onPress={tap}
      style={half.side === 'first' ? firstStyle : secondStyle}
    >
      <View style={styles.head}>
        <Text variant="label" numberOfLines={2} style={styles.names}>
          {half.label}
        </Text>
        {serving === null ? null : <ServingPlate word={serving} />}
      </View>
      <Text variant="score">{half.value}</Text>
      {sub === null ? null : <Text variant="control">{sub}</Text>}
    </Pressable>
  );
});

/** The serving marker: a lime plate with night ink, an area a scorer reads from the side of a court. */
const ServingPlate = memo(function ServingPlate({ word }: { readonly word: string }) {
  return (
    <View testID="serving" style={styles.plate}>
      <Text variant="state" style={styles.plateWord}>
        {word}
      </Text>
    </View>
  );
});

const isWords = (part: string | null): part is string => part !== null && part !== '';

const styles = StyleSheet.create({
  half: {
    flex: 1,
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  first: { borderLeftColor: colour.lime },
  second: { borderLeftColor: colour.ink3 },
  pressed: { backgroundColor: colour.surface2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  names: { flex: 1 },
  plate: { paddingHorizontal: space.sm, paddingVertical: space.xs, backgroundColor: colour.lime },
  plateWord: { color: plateInk },
});

/** Module-level so render allocates no function; pressed lifts the half to surface2. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const firstStyle = pressable([styles.half, styles.first]);
const secondStyle = pressable([styles.half, styles.second]);
