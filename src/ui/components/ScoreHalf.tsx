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
import type { PadCard, PadHalf, PadPeriodScore, PadSide, PadText } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Glyph } from '@/ui/components/Glyph';
import { NameText } from '@/ui/components/NameText';
import { SidePlate } from '@/ui/components/SidePlate';
import { TapFlash } from '@/ui/components/TapFlash';
import { Text } from '@/ui/components/Text';
import { scoreRole } from '@/ui/theme/scoreRole';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

type PadWords = ReturnType<typeof usePadText>;

type ScoreHalfProps = {
  readonly half: PadHalf<MessageKey>;
  /** The half's flash cue (`flashCue`): it flashes when this moves to a new counted tap of its own. */
  readonly flash: number;
  readonly onTap: (side: PadSide) => void;
};

/**
 * One side's half of the pad (layout A, owner 2026-10-31): the whole half is the button that gives that side the
 * rally, far larger than any other target. The names as typed, the serving plate, with the service court on it
 * (owner ruling 17), and a sport's own plate word if it has one (`PadHalf.plate`: chess's WHITE and BLACK), on top, then at the far right the marks (owner ruling 56, 2026-11-04): a stopwatch while the sport's
 * clock rule is in force and the side's card; the big value in the LED lime, centred in the space between them and the
 * bottom row, at the largest size the half holds (`scoreRole`); the bottom row: the finished games' boxes (owner ruling
 * 16), a sport's one line after them if it has one (table tennis's doubles server) and the visible hint, the one word
 * "Tap" (owner ruling 56, which superseded ruling 14's "Tap: rally to …") unless the sport labels its tap
 * (`PadHalf.action`: chess's "White won · A. Sharma"). A tap that counted flashes the half
 * (`TapFlash`). A screen reader reads the side, the value, the finished games, the card and Expedite, and Serving with
 * the court as one name, and `hint` says what a tap does; the boxes, the marks and the visible hint are hidden from it,
 * so nothing is read twice. A half that takes no tap (a card is up, a match is over) is disabled, draws the same, and
 * shows no hint.
 */
export const ScoreHalf = memo(function ScoreHalf({ half, flash, onTap }: ScoreHalfProps) {
  const words = usePadText();
  const tap = useCallback(() => onTap(half.side), [onTap, half.side]);
  const [height, measure] = useHeight();
  const sub = half.sub === null ? null : words(half.sub);
  const said = half.marks.said.map(words);
  return (
    <Pressable
      testID={`half-${half.side}`}
      accessibilityRole="button"
      accessibilityLabel={halfName(half, words, sub, said)}
      accessibilityHint={words(half.hint)}
      disabled={!half.tappable}
      onPress={tap}
      onLayout={measure}
      style={half.bar === 'lit' ? litStyle : dimStyle}
    >
      <TapFlash cue={flash} />
      <HalfHead half={half} />
      <View style={styles.middle}>
        <Text testID="score" variant={scoreRole(height)}>
          {half.value}
        </Text>
      </View>
      <HalfFoot
        scores={half.periods?.scores ?? NO_SCORES}
        sub={sub}
        hint={half.tappable ? words(half.action ?? TAP) : null}
      />
    </Pressable>
  );
});

/** The half's height as laid out, which sets the score's size (`scoreRole`); null until it is measured. */
function useHeight(): readonly [number | null, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = useState<number | null>(null);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  );
  return [height, measure];
}

/**
 * The visible hint (owner ruling 56): the one word "Tap", the same in every sport and for every side, so the kit says it
 * and a half carries no line of its own for it. A screen reader hears `hint` instead.
 */
const TAP: PadText<MessageKey> = { key: 'scoring.pad.tap' };

/**
 * The half's one name to a screen reader: side, value, finished games, the line after them, the marks (the card's name,
 * then Expedite), and Serving with the court.
 */
function halfName(
  half: PadHalf<MessageKey>,
  words: PadWords,
  sub: string | null,
  marks: readonly string[],
): string {
  const periods = half.periods === null ? NO_WORDS : half.periods.said.map(words);
  const serving = half.serving === null ? null : words(half.serving.said);
  const plate = half.plate === null ? null : words(half.plate);
  return [half.label, half.value, ...periods, sub, ...marks, serving, plate]
    .filter(isWords)
    .join(', ');
}

/**
 * The top of the half: the names as typed, the serving plate with the court on it (owner ruling 17) and, at the far
 * right, the marks (owner ruling 56). The names give way (two lines, then an ellipsis); the plate and the marks never do.
 */
const HalfHead = memo(function HalfHead({ half }: { readonly half: PadHalf<MessageKey> }) {
  const words = usePadText();
  return (
    <View style={styles.head}>
      <NameText variant="label" lines={layout.padNameLines} style={styles.names}>
        {half.label}
      </NameText>
      {half.serving === null ? null : <ServingPlate words={words(half.serving.shown)} />}
      {half.plate === null ? null : <SidePlate words={words(half.plate)} />}
      <HalfMarks clock={half.marks.clock} cards={half.marks.cards} />
    </View>
  );
});

/**
 * The marks in the half's top-right corner (owner ruling 56): a stopwatch while the sport's clock rule is in force
 * (table tennis's Expedite, on both halves), then the side's cards. Drawings only: a screen reader hears their words in
 * the half's name. Nothing at all when a half has none, so its names keep the whole row.
 */
const HalfMarks = memo(function HalfMarks({
  clock,
  cards,
}: {
  readonly clock: boolean;
  readonly cards: readonly PadCard[];
}) {
  if (!clock && cards.length === 0) return null;
  return (
    <View testID="marks" aria-hidden style={styles.marks}>
      {clock ? <Glyph name="stopwatch" tone="ink" size={layout.padMarkGlyph} /> : null}
      {cards.map((card, at) => (
        // A card's place is its identity: the pair is yellow then red, and only ever changes whole.
        <View key={at} testID="mark-card" style={cardStyle[card]} />
      ))}
    </View>
  );
});

/**
 * The bottom row, one line (owner rulings 14, 16 and 56): the finished games' boxes, a dot and the line after them
 * (table tennis's doubles server) when there are both, and the hint, the word "Tap", at the right. The boxes and the
 * line keep their width; the hint takes what is left, cut with an ellipsis, down to nothing (padFit.test.ts). No row is
 * taller than a box (`halfNeeds`). The boxes and the hint are hidden from a screen reader, which hears the half's name
 * and `hint`.
 */
const HalfFoot = memo(function HalfFoot({
  scores,
  sub,
  hint,
}: {
  readonly scores: readonly PadPeriodScore<MessageKey>[];
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

/** Typography, not copy (as the domain's en dash in a score): between the boxes and the line after them ("[21] · M. Wong serves"). */
const SEPARATOR = '·';
const NO_SCORES: readonly PadPeriodScore<MessageKey>[] = [];
const NO_WORDS: readonly string[] = [];

/**
 * The side's score in each game over, in game order: a game it won in lime, digits and hairline (owner ruling 16); a
 * game a disqualification ended carries its mark (owner ruling 18).
 */
const PeriodBoxes = memo(function PeriodBoxes({
  scores,
}: {
  readonly scores: readonly PadPeriodScore<MessageKey>[];
}) {
  return (
    <View testID="periods" aria-hidden style={styles.boxes}>
      {scores.map((score, at) => (
        // A finished game's place is its identity: games are only ever added or taken away at the end.
        <PeriodBox key={at} score={score} />
      ))}
    </View>
  );
});

/** One game's box: its score, and a mark when the game ended otherwise ("DQ"), small and in caution, after it. */
const PeriodBox = memo(function PeriodBox({
  score,
}: {
  readonly score: PadPeriodScore<MessageKey>;
}) {
  const words = usePadText();
  return (
    <View testID="period" style={score.won ? wonBox : lostBox}>
      <Text variant="periodScore" style={score.won ? styles.wonDigits : styles.lostDigits}>
        {score.value}
      </Text>
      {score.mark === undefined ? null : (
        <Text testID="period-mark" variant="metricUnit" style={styles.mark}>
          {words(score.mark)}
        </Text>
      )}
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
  // The edge bar is the sport's call (`PadHalf.bar`), not the side's: lit is the LED lime, dim is lilac.
  lit: { borderLeftColor: colour.lime },
  dim: { borderLeftColor: colour.ink3 },
  pressed: { backgroundColor: colour.surface2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  names: { flex: 1 },
  // The row is as tall as the stopwatch, and a card sits at its middle; a View never shrinks, so only the names give way.
  marks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: layout.padMarkGlyph,
  },
  // An upright card (owner ruling 56): the token's colour, and a hairline so its edge reads against the night ground.
  card: {
    width: layout.padCardWidth,
    height: layout.padCardHeight,
    borderRadius: layout.padCardRadius,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  caution: { backgroundColor: colour.cardCaution },
  dismissal: { backgroundColor: colour.cardDismissal },
  // The space between the names and the bottom row: the score sits in its middle, across and down.
  middle: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The boxes, the dot and the line after them are never cut: only the hint gives way (owner ruling 16). A View never shrinks
  // (Yoga's default, and react-native-web's); a Text is told so.
  kept: { flexShrink: 0 },
  hint: { flex: 1, minWidth: 0, textAlign: 'right' },
  boxes: { flexDirection: 'row', gap: space.xs },
  box: {
    flexDirection: 'row',
    gap: space.xs,
    minWidth: layout.padPeriodBox,
    paddingHorizontal: space.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: layout.iconBorder,
  },
  // A hairline, never a plate: the lime plate is the serving marker's (AGENTS §5: lime ink on night).
  won: { borderColor: colour.lime },
  lost: { borderColor: colour.ink3 },
  wonDigits: { color: colour.lime },
  lostDigits: { color: colour.ink2 },
  // A disqualification's mark: the sanction tools' caution (never red: red means ON AIR, AGENTS §5).
  mark: { color: colour.caution },
  plate: { paddingHorizontal: space.sm, paddingVertical: space.xs, backgroundColor: colour.lime },
  plateWord: { color: plateInk },
});

/** Module-level so render allocates no function; pressed lifts the half to surface2. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const litStyle = pressable([styles.half, styles.lit]);
/** Module-level, so render allocates no style array: a card's drawing by its family (the tokens are the kit's choice). */
const cardStyle: Readonly<Record<PadCard, StyleProp<ViewStyle>>> = {
  caution: [styles.card, styles.caution],
  dismissal: [styles.card, styles.dismissal],
};
const wonBox = [styles.box, styles.won];
const lostBox = [styles.box, styles.lost];
const dimStyle = pressable([styles.half, styles.dim]);
