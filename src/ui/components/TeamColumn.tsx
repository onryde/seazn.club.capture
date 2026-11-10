import { Fragment, memo, type ReactNode, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import type { PadBar } from '@/domain/scoring/padView';
import { NameText } from '@/ui/components/NameText';
import { Text } from '@/ui/components/Text';
import { type BoardTier, goalHeight, MARKS_HEIGHT, TIER_FACES } from '@/ui/theme/columnBoard';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * One button in a team's column, in the operator's words already (the sport's screen translates its own board): its id
 * goes back to the caller; the primary one is the lime Goal square, which carries the column's score; a disabled one may
 * say why, on a line under its word. `said` is what a screen reader hears when it is more than the word ("Goal, Home FC,
 * 2"); `swatch` marks a card button and puts it in the row of two.
 */
export type TeamAction = {
  readonly id: string;
  readonly label: string;
  readonly said: string | null;
  readonly primary: boolean;
  readonly enabled: boolean;
  readonly note: string | null;
  readonly swatch: 'caution' | 'dismissal' | null;
};

/** What a team's column draws: nothing here is decided, only drawn (S2-5 design §6.2). */
export type TeamColumnView = {
  /** The team's name as typed. */
  readonly label: string;
  /** The edge bar: lit (lime) for the first side, dim (lilac) for the second, as the match label (AGENTS §6, C2). */
  readonly bar: PadBar;
  /** The score, drawn as the big numeral inside the primary button (owner ruling 132). */
  readonly value: string;
  readonly cards: { readonly yellow: number; readonly red: number };
  /** What a screen reader hears for the marks, in the sport's words; the marks themselves are drawings. */
  readonly said: readonly string[];
  /** A sport's own marks after the cards (a sin-bin's player, ticking on its own): drawn as given. */
  readonly tags: readonly ReactNode[];
  readonly actions: readonly TeamAction[];
};

type TeamColumnProps = {
  readonly view: TeamColumnView;
  readonly onAction: (id: string) => void;
  /** A compact board's column (`columnBoard.ts`): the name on one line, the Goal square a row. */
  readonly compact?: boolean;
};

/**
 * A team's column on a pad whose score is not a tap (S2-5 design §6.2, rulings 105 and 132): the name as typed heads it
 * (two lines, then an ellipsis, a fixed height so two columns line up), then one line of marks (a card icon per colour
 * with its count, then the sport's tags), the lime Goal square with the score as its numeral and its word under it, a
 * row of the card buttons (each with its colour's swatch), and the other buttons full width, each at least a touch
 * target. A kit part with no sport named (the controller's ruling 5). A screen reader hears the name and the marks as
 * one, then each button; the square says its score.
 *
 * The controller's fix-round rulings: the name shrinks to fit before its ellipsis, so no word breaks at a letter (a);
 * the marks' row is one line of fixed height, so the buttons never move (b); the numeral shrinks to fit its line and is
 * never cut (f). Compact (R1) sets the name on one line and the square as a row of numeral and word, so a short phone
 * keeps a touch target per button. footballFit.test.ts holds the numbers.
 */
export const TeamColumn = memo(function TeamColumn({ view, onAction, compact }: TeamColumnProps) {
  const tier: BoardTier = compact === true ? 'compact' : 'full';
  const swatched = view.actions.filter((action) => action.swatch !== null);
  return (
    <View testID="team-column" style={columnStyle(view.bar, tier)}>
      <ColumnHead view={view} tier={tier} />
      {view.actions.map((action) => {
        if (action.swatch !== null) {
          return action === swatched[0] ? (
            <View key="cards" testID="column-cards" style={rowStyle(tier)}>
              {swatched.map((card) => (
                <CardButton key={card.id} action={card} onAction={onAction} />
              ))}
            </View>
          ) : null;
        }
        return action.primary ? (
          <GoalSquare
            key={action.id}
            action={action}
            value={view.value}
            tier={tier}
            onAction={onAction}
          />
        ) : (
          <ColumnButton key={action.id} action={action} onAction={onAction} />
        );
      })}
    </View>
  );
});

type ColumnHeadProps = { readonly view: TeamColumnView; readonly tier: BoardTier };

/** The head: the name, and the marks' row under it, heard as one. */
const ColumnHead = memo(function ColumnHead({ view, tier }: ColumnHeadProps) {
  const faces = TIER_FACES[tier];
  return (
    <View
      accessible
      accessibilityLabel={[view.label, ...view.said].join(', ')}
      style={headStyle(tier)}
    >
      <NameText
        variant="matchName"
        lines={faces.nameLines}
        floor={layout.teamNameFloor}
        style={tier === 'compact' ? styles.nameCompact : styles.name}
      >
        {view.label}
      </NameText>
      <View testID="column-marks-room" style={styles.marksRoom}>
        <ColumnMarks cards={view.cards} tags={view.tags} />
      </View>
    </View>
  );
});

/** The marks' row: a card icon per colour the team has, with its count, then the sport's tags. Nothing when none. */
const ColumnMarks = memo(function ColumnMarks({
  cards,
  tags,
}: {
  readonly cards: TeamColumnView['cards'];
  readonly tags: readonly ReactNode[];
}) {
  if (cards.yellow === 0 && cards.red === 0 && tags.length === 0) return null;
  return (
    <View testID="column-marks" aria-hidden style={styles.marks}>
      {cards.yellow === 0 ? null : <CardCount style={cautionCard} count={cards.yellow} />}
      {cards.red === 0 ? null : <CardCount style={dismissalCard} count={cards.red} />}
      {tags.map((tag, at) => (
        // A tag's place is its identity: the sport hands them in its own order, whole.
        <Fragment key={at}>{tag}</Fragment>
      ))}
    </View>
  );
});

/** One card icon (the pad's, AGENTS §5: a drawing, not a status) and how many of that colour the team has. */
const CardCount = memo(function CardCount({
  style,
  count,
}: {
  readonly style: StyleProp<ViewStyle>;
  readonly count: number;
}) {
  return (
    <View style={styles.cardCount}>
      <View testID="mark-card" style={style} />
      <Text testID="mark-count" variant="periodScore" style={styles.count}>
        {count}
      </Text>
    </View>
  );
});

type ColumnButtonProps = { readonly action: TeamAction; readonly onAction: (id: string) => void };

const nameOf = (action: TeamAction): string =>
  action.said ?? (action.note === null ? action.label : `${action.label}, ${action.note}`);

type GoalSquareProps = ColumnButtonProps & {
  readonly value: string;
  readonly tier: BoardTier;
};

/**
 * The primary button, the lime plate with night ink (AGENTS §5), with the team's score as its numeral and the word under
 * it (a row in a compact column). The numeral shrinks to fit its line, down to `layout.scoreFloor`, and is never cut.
 */
const GoalSquare = memo(function GoalSquare({ action, value, tier, onAction }: GoalSquareProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  const off = !action.enabled;
  return (
    <Pressable
      testID="goal-square"
      accessibilityRole="button"
      accessibilityLabel={nameOf(action)}
      disabled={off}
      onPress={press}
      style={squareStyle(tier, off)}
    >
      <Text
        testID="column-value"
        aria-hidden
        variant={TIER_FACES[tier].numeral}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.scoreFloor}
        style={[styles.numeral, off ? styles.labelOff : styles.labelPrimary]}
      >
        {value}
      </Text>
      <Text
        aria-hidden
        variant="diagSection"
        numberOfLines={1}
        style={off ? styles.labelOff : styles.labelPrimary}
      >
        {action.label}
      </Text>
    </Pressable>
  );
});

/** Yellow or Red: outlined on `surface2`, a small square swatch of the card's colour before its word. */
const CardButton = memo(function CardButton({ action, onAction }: ColumnButtonProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nameOf(action)}
      disabled={!action.enabled}
      onPress={press}
      style={action.enabled ? cardPressable : cardOff}
    >
      <View
        testID="card-swatch"
        style={action.swatch === 'dismissal' ? dismissalSwatch : cautionSwatch}
      />
      <Text
        variant="diagSection"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.cardLabelFloor}
        style={styles.cardLabel}
      >
        {action.label}
      </Text>
    </Pressable>
  );
});

/** A team's other button (Sub, Missed): full width on `surface2`; a disabled one greys, with its note under its word. */
const ColumnButton = memo(function ColumnButton({ action, onAction }: ColumnButtonProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nameOf(action)}
      disabled={!action.enabled}
      onPress={press}
      style={action.enabled ? otherButton : otherOff}
    >
      <Text
        variant="actionSecondary"
        numberOfLines={1}
        style={action.enabled ? styles.labelOther : styles.labelOff}
      >
        {action.label}
      </Text>
      {action.note === null ? null : (
        <Text
          variant="metricUnit"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={layout.noteFloor}
          style={styles.note}
        >
          {action.note}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minWidth: 0,
    padding: space.sm,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  gapFull: { gap: TIER_FACES.full.gap },
  gapCompact: { gap: TIER_FACES.compact.gap },
  lit: { borderLeftColor: colour.lime },
  dim: { borderLeftColor: colour.ink3 },
  // Two lines' room whatever the name, so the two columns' squares and buttons line up side by side (footballFit.test.ts);
  // one line's in a compact head.
  name: { minHeight: layout.padNameLines * typeScale.matchName.lineHeight },
  nameCompact: { minHeight: typeScale.matchName.lineHeight },
  // The marks' room is there with no marks too, so a card or a tag never moves the buttons, nor puts one team's under
  // the other's out of line. One line: a tag that does not fit ends in an ellipsis (the sport's own Text), never wraps.
  marksRoom: { height: MARKS_HEIGHT, overflow: 'hidden' },
  marks: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: space.sm },
  cardCount: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  card: {
    width: layout.padCardWidth,
    height: layout.padCardHeight,
    borderRadius: layout.padCardRadius,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  caution: { backgroundColor: colour.cardCaution },
  dismissal: { backgroundColor: colour.cardDismissal },
  count: { color: colour.ink2 },
  // The Goal square takes what the column's other rows leave; the others are a touch target each.
  square: {
    flex: 1,
    minHeight: goalHeight('full'),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.card,
    backgroundColor: colour.lime,
  },
  squareCompact: {
    minHeight: goalHeight('compact'),
    flexDirection: 'row',
    gap: space.sm,
  },
  squareOff: { backgroundColor: colour.surface2 },
  numeral: { flexShrink: 1 },
  cardRow: { flexDirection: 'row', gap: space.xs },
  cardButton: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    backgroundColor: colour.surface2,
  },
  swatch: {
    width: layout.padSwatch,
    height: layout.padSwatch,
    borderRadius: layout.padCardRadius,
  },
  cardLabel: { flexShrink: 1, color: colour.ink },
  button: {
    minHeight: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    backgroundColor: colour.surface2,
  },
  pressedPlate: { opacity: pressedOpacity.plate },
  pressedOther: { backgroundColor: colour.pressFill },
  labelPrimary: { color: plateInk },
  labelOther: { color: colour.ink },
  labelOff: { color: colour.ink3 },
  note: { textAlign: 'center' },
});

/** Module-level so render allocates no function. Pressed: the plate dims, the other buttons take the press fill. */
function pressable(rest: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  const down = [rest, pressedStyle];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const COLUMN: Record<BoardTier, Record<'lit' | 'dim', StyleProp<ViewStyle>>> = {
  full: {
    lit: [styles.column, styles.gapFull, styles.lit],
    dim: [styles.column, styles.gapFull, styles.dim],
  },
  compact: {
    lit: [styles.column, styles.gapCompact, styles.lit],
    dim: [styles.column, styles.gapCompact, styles.dim],
  },
};
const columnStyle = (bar: PadBar, tier: BoardTier) => COLUMN[tier][bar === 'lit' ? 'lit' : 'dim'];
const HEAD: Record<BoardTier, StyleProp<ViewStyle>> = {
  full: styles.gapFull,
  compact: styles.gapCompact,
};
const headStyle = (tier: BoardTier) => HEAD[tier];
const ROWS: Record<BoardTier, StyleProp<ViewStyle>> = {
  full: [styles.cardRow, styles.gapFull],
  compact: [styles.cardRow, styles.gapCompact],
};
const rowStyle = (tier: BoardTier) => ROWS[tier];
const SQUARE_ON: Record<BoardTier, ReturnType<typeof pressable>> = {
  full: pressable(styles.square, styles.pressedPlate),
  compact: pressable([styles.square, styles.squareCompact], styles.pressedPlate),
};
const SQUARE_OFF: Record<BoardTier, StyleProp<ViewStyle>> = {
  full: [styles.square, styles.squareOff],
  compact: [styles.square, styles.squareCompact, styles.squareOff],
};
const squareStyle = (tier: BoardTier, off: boolean) => (off ? SQUARE_OFF[tier] : SQUARE_ON[tier]);

const cautionCard = [styles.card, styles.caution];
const dismissalCard = [styles.card, styles.dismissal];
const cautionSwatch = [styles.swatch, styles.caution];
const dismissalSwatch = [styles.swatch, styles.dismissal];
const cardPressable = pressable(styles.cardButton, styles.pressedOther);
const cardOff: StyleProp<ViewStyle> = [styles.cardButton];
const otherButton = pressable(styles.button, styles.pressedOther);
const otherOff: StyleProp<ViewStyle> = styles.button;
