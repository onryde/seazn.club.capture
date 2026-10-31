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
import type { PadHalf, PadPeriodScore, PadSide } from '@/domain/scoring/padView';
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
 * rally, far larger than any other target. The names as typed and the serving plate, with the service court on it
 * (owner ruling 17), on top; the big value in the LED lime, centred in the space between them and the bottom row, at
 * the largest size the half holds (`scoreRole`); the bottom row: the finished games' boxes (owner ruling 16), the
 * sanction and the visible hint (owner ruling 14). A tap that counted flashes the half (`TapFlash`). A screen reader
 * reads the side, the value, the finished games, the sanction and Serving with the court as one name, and `hint` says
 * what a tap does; the boxes and the visible hint are hidden from it, so nothing is read twice. A half that takes no
 * tap (a card is up, a match is over) is disabled, draws the same, and shows no hint.
 */
export const ScoreHalf = memo(function ScoreHalf({ half, flash, onTap }: ScoreHalfProps) {
  const words = usePadText();
  const tap = useCallback(() => onTap(half.side), [onTap, half.side]);
  // The half as laid out sets the score's size (`scoreRole`); null until it is measured.
  const [height, setHeight] = useState<number | null>(null);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  );
  const sub = half.sub === null ? null : words(half.sub);
  const periods = half.periods === null ? null : words(half.periods.said);
  const serving = half.serving === null ? null : words(half.serving.said);
  const name = [half.label, half.value, periods, sub, serving].filter(isWords).join(', ');
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
        {half.serving === null ? null : <ServingPlate words={words(half.serving.shown)} />}
      </View>
      <View style={styles.middle}>
        <Text testID="score" variant={scoreRole(height)}>
          {half.value}
        </Text>
      </View>
      <HalfFoot
        scores={half.periods?.scores ?? NO_SCORES}
        sub={sub}
        hint={half.tappable ? words(half.hintLine) : null}
      />
    </Pressable>
  );
});

/**
 * The bottom row, one line (owner rulings 14 and 16): the finished games' boxes, a dot and the sanction when there are
 * both, and the hint at the right. The boxes and the sanction keep their width; the hint takes what is left, cut with
 * an ellipsis, down to nothing (padFit.test.ts: at 320 dp, best of 3, it always keeps some). No row is taller than a
 * box (`halfNeeds`). The boxes and the hint are hidden from a screen reader, which hears the half's name and `hint`.
 */
const HalfFoot = memo(function HalfFoot({
  scores,
  sub,
  hint,
}: {
  readonly scores: readonly PadPeriodScore[];
  readonly sub: string | null;
  readonly hint: string | null;
}) {
  const boxed = scores.length > 0;
  return (
    <View style={styles.foot}>
      {boxed ? <PeriodBoxes scores={scores} /> : null}
      {boxed && sub !== null ? (
        <Text variant="control" aria-hidden style={styles.kept}>
          {SEPARATOR}
        </Text>
      ) : null}
      {sub === null ? null : (
        <Text variant="control" style={styles.kept}>
          {sub}
        </Text>
      )}
      {hint === null ? null : (
        <Text variant="metricUnit" numberOfLines={1} aria-hidden style={styles.hint}>
          {hint}
        </Text>
      )}
    </View>
  );
});

/** Typography, not copy (as the domain's en dash in a score): between the boxes and the sanction ("[21] · Penalty"). */
const SEPARATOR = '·';
const NO_SCORES: readonly PadPeriodScore[] = [];

/** The side's score in each finished game, in game order: a game it won in lime, digits and hairline (ruling 16). */
const PeriodBoxes = memo(function PeriodBoxes({
  scores,
}: {
  readonly scores: readonly PadPeriodScore[];
}) {
  return (
    <View testID="periods" aria-hidden style={styles.boxes}>
      {scores.map((score, at) => (
        // A finished game's place is its identity: games are only ever added or taken away at the end.
        <View key={at} testID="period" style={score.won ? wonBox : lostBox}>
          <Text variant="periodScore" style={score.won ? styles.wonDigits : styles.lostDigits}>
            {score.value}
          </Text>
        </View>
      ))}
    </View>
  );
});

/**
 * The serving marker: a lime plate with night ink, an area a scorer reads from the side of a court, naming the
 * service court on its one line ("SERVING · RIGHT", owner ruling 17; padFit.test.ts holds it beside doubles names at
 * 320 dp in four languages).
 */
const ServingPlate = memo(function ServingPlate({ words }: { readonly words: string }) {
  return (
    <View testID="serving" style={styles.plate}>
      <Text variant="state" style={styles.plateWord}>
        {words}
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
  // The boxes, the dot and the sanction are never cut: only the hint gives way (owner ruling 16). A View never shrinks
  // (Yoga's default, and react-native-web's); a Text is told so.
  kept: { flexShrink: 0 },
  hint: { flex: 1, minWidth: 0, textAlign: 'right' },
  boxes: { flexDirection: 'row', gap: space.xs },
  box: {
    minWidth: layout.padPeriodBox,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    borderWidth: layout.iconBorder,
  },
  // A hairline, never a plate: the lime plate is the serving marker's (AGENTS §5: lime ink on night).
  won: { borderColor: colour.lime },
  lost: { borderColor: colour.ink3 },
  wonDigits: { color: colour.lime },
  lostDigits: { color: colour.ink2 },
  plate: { paddingHorizontal: space.sm, paddingVertical: space.xs, backgroundColor: colour.lime },
  plateWord: { color: plateInk },
});

/** Module-level so render allocates no function; pressed lifts the half to surface2. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const firstStyle = pressable([styles.half, styles.first]);
const wonBox = [styles.box, styles.won];
const lostBox = [styles.box, styles.lost];
const secondStyle = pressable([styles.half, styles.second]);
