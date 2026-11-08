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
import { type BoardTier, MARKS_HEIGHT, TIER_FACES } from '@/ui/theme/columnBoard';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * One button in a team's column, in the operator's words already (the sport's screen translates its own board): its id
 * goes back to the caller; the primary one is the lime plate; a disabled one may say why, on a line under its word.
 */
export type TeamAction = {
  readonly id: string;
  readonly label: string;
  readonly primary: boolean;
  readonly enabled: boolean;
  readonly note: string | null;
};

/** What a team's column draws: nothing here is decided, only drawn (S2-5 design §6.2). */
export type TeamColumnView = {
  /** The team's name as typed. */
  readonly label: string;
  /** The edge bar: lit (lime) for the first side, dim (lilac) for the second, as the match label (AGENTS §6, C2). */
  readonly bar: PadBar;
  readonly value: string;
  /** Whether the team leads: its value is the LED lime, else cream. */
  readonly lead: boolean;
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
  /** A compact board's column (fix-round 2 ruling R1, `columnBoard.ts`): the name on one line, the score a step down. */
  readonly compact?: boolean;
};

/**
 * A team's column on a pad whose score is not a tap (S2-5 design §6.2, ruling 105): the name as typed (two lines, then
 * an ellipsis), the score, a row of marks only when there are any (a card icon per colour with its count, then the
 * sport's tags), and the team's buttons, which share the rest of the height by weight (`layout.columnPrimary`,
 * `layout.columnAction`), each at least a touch target. A kit part with no sport named (the controller's ruling 5).
 * A screen reader hears the name, the score and the marks as one, then each button.
 *
 * The controller's fix-round rulings: the name shrinks to fit before its ellipsis, so no word breaks at a letter (a);
 * the marks' row is one line of fixed height, so the buttons never move (b); the score shrinks to fit its line and is
 * never cut (f). A compact board's column (fix-round 2, R1, superseding round 1's own measure) sets the name on one
 * line and the score a step down, so a short phone keeps a touch target per button. footballFit.test.ts holds the numbers.
 */
export const TeamColumn = memo(function TeamColumn({ view, onAction, compact }: TeamColumnProps) {
  return (
    <View testID="team-column" style={view.bar === 'lit' ? litColumn : dimColumn}>
      <ColumnHead view={view} tier={compact === true ? 'compact' : 'full'} />
      {view.actions.map((action) => (
        <ColumnButton key={action.id} action={action} onAction={onAction} />
      ))}
    </View>
  );
});

type ColumnHeadProps = { readonly view: TeamColumnView; readonly tier: BoardTier };

/** The head: the name, the score and the marks' row, heard as one. */
const ColumnHead = memo(function ColumnHead({ view, tier }: ColumnHeadProps) {
  const faces = TIER_FACES[tier];
  return (
    <View
      accessible
      accessibilityLabel={[view.label, view.value, ...view.said].join(', ')}
      style={styles.head}
    >
      <NameText
        variant="matchName"
        lines={faces.nameLines}
        floor={layout.teamNameFloor}
        style={tier === 'compact' ? styles.nameCompact : styles.name}
      >
        {view.label}
      </NameText>
      <ColumnScore value={view.value} lead={view.lead} role={faces.score} />
      <View testID="column-marks-room" style={styles.marksRoom}>
        <ColumnMarks cards={view.cards} tags={view.tags} />
      </View>
    </View>
  );
});

type ColumnScoreProps = { readonly value: string; readonly lead: boolean; readonly role: TypeRole };

/** The score on its one line, shrinking to fit and never cut (ruling f): lime while the team leads, else cream. */
function ColumnScore({ value, lead, role }: ColumnScoreProps) {
  return (
    <Text
      testID="column-value"
      variant={role}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={layout.scoreFloor}
      style={lead ? undefined : styles.trailing}
    >
      {value}
    </Text>
  );
}

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

/** A team's button: the lime plate with night ink when primary, else `surface2`; a disabled one greys, with its note. */
const ColumnButton = memo(function ColumnButton({ action, onAction }: ColumnButtonProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  const name = action.note === null ? action.label : `${action.label}, ${action.note}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      disabled={!action.enabled}
      onPress={press}
      style={buttonStyle(action)}
    >
      <Text variant="actionSecondary" numberOfLines={1} style={labelStyle(action)}>
        {action.label}
      </Text>
      {action.note === null ? null : (
        <Text variant="metricUnit" numberOfLines={2} style={styles.note}>
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
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  lit: { borderLeftColor: colour.lime },
  dim: { borderLeftColor: colour.ink3 },
  head: { gap: space.xs },
  // Two lines' room whatever the name, so the two columns' scores and buttons line up side by side (footballFit.test.ts);
  // one line's in a compact head.
  name: { minHeight: layout.padNameLines * typeScale.matchName.lineHeight },
  nameCompact: { minHeight: typeScale.matchName.lineHeight },
  trailing: { color: colour.ink },
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
  button: {
    minHeight: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    backgroundColor: colour.surface2,
  },
  primary: { flex: layout.columnPrimary, backgroundColor: colour.lime },
  other: { flex: layout.columnAction },
  off: { backgroundColor: colour.surface2 },
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

const litColumn = [styles.column, styles.lit];
const dimColumn = [styles.column, styles.dim];
const cautionCard = [styles.card, styles.caution];
const dismissalCard = [styles.card, styles.dismissal];
const primaryButton = pressable([styles.button, styles.primary], styles.pressedPlate);
const otherButton = pressable([styles.button, styles.other], styles.pressedOther);
// A disabled primary button keeps its weight but not its plate: it greys as the others do.
const primaryOff: StyleProp<ViewStyle> = [styles.button, styles.primary, styles.off];
const otherOff: StyleProp<ViewStyle> = [styles.button, styles.other];

function buttonStyle(action: TeamAction) {
  if (!action.enabled) return action.primary ? primaryOff : otherOff;
  return action.primary ? primaryButton : otherButton;
}

function labelStyle(action: TeamAction) {
  if (!action.enabled) return styles.labelOff;
  return action.primary ? styles.labelPrimary : styles.labelOther;
}
