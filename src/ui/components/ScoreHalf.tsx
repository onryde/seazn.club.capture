import { memo, useCallback, useState } from 'react';
import {
  type LayoutChangeEvent,
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
import { TapFlash } from '@/ui/components/TapFlash';
import { Text } from '@/ui/components/Text';
import { scoreRole } from '@/ui/theme/scoreRole';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

type ScoreHalfProps = {
  readonly half: PadHalf<MessageKey>;
  /** The half's flash cue (`flashCue`): it flashes when this moves to a new counted tap of its own. */
  readonly flash: number;
  readonly onTap: (side: PadSide) => void;
};

/**
 * One side's half of the pad (layout A, owner 2026-10-31): the whole half is the button that gives that side the
 * rally, far larger than any other target. The names as typed and the serving plate on top; the big value in the LED
 * lime, centred in the space between them and the bottom row, at the largest size the half holds (`scoreRole`); the
 * bottom row, the games line and the visible hint (owner ruling 14). A tap that counted flashes the half (`TapFlash`).
 * A screen reader reads the side, the value, the line and Serving as one name, and `hint` says what a tap does; the
 * visible hint is hidden from it, so it is not read twice. A half that takes no tap (a card is up, a match is over) is
 * disabled, draws the same, and shows no hint.
 */
export const ScoreHalf = memo(function ScoreHalf({ half, flash, onTap }: ScoreHalfProps) {
  const { t } = useT();
  const words = usePadText();
  const tap = useCallback(() => onTap(half.side), [onTap, half.side]);
  // The half as laid out sets the score's size (`scoreRole`); null until it is measured.
  const [height, setHeight] = useState<number | null>(null);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  );
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
      onLayout={measure}
      style={half.side === 'first' ? firstStyle : secondStyle}
    >
      <TapFlash cue={flash} />
      <View style={styles.head}>
        <Text variant="label" numberOfLines={layout.padNameLines} style={styles.names}>
          {half.label}
        </Text>
        {serving === null ? null : <ServingPlate word={serving} />}
      </View>
      <View style={styles.middle}>
        <Text variant={scoreRole(height)}>{half.value}</Text>
      </View>
      <HalfFoot sub={sub} hint={half.tappable ? words(half.hintLine) : null} />
    </Pressable>
  );
});

/**
 * The bottom row: the games line at its left and the hint at its right, one line, cut with an ellipsis (owner ruling
 * 14). The hint's line is shorter than the games line's, so the row is no taller than the games line alone
 * (`halfNeeds`). The hint is the half's own words, hidden from a screen reader, which hears the half's `hint`.
 */
const HalfFoot = memo(function HalfFoot({
  sub,
  hint,
}: {
  readonly sub: string | null;
  readonly hint: string | null;
}) {
  return (
    <View style={styles.foot}>
      {sub === null ? null : <Text variant="control">{sub}</Text>}
      {hint === null ? null : (
        <Text variant="metricUnit" numberOfLines={1} aria-hidden style={styles.hint}>
          {hint}
        </Text>
      )}
    </View>
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
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
    // Shorter than even `scoreCompact` needs (a card above the halves on a short phone): cut, never drawn over the other.
    overflow: 'hidden',
  },
  first: { borderLeftColor: colour.lime },
  second: { borderLeftColor: colour.ink3 },
  pressed: { backgroundColor: colour.surface2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  names: { flex: 1 },
  // The space between the names and the bottom row: the score sits in its middle, across and down.
  middle: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hint: { flex: 1, minWidth: 0, textAlign: 'right' },
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
