import { Fragment, memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  type LayoutChangeEvent,
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
import {
  type BoardTier,
  goalHeight,
  goalNumeralSize,
  goalSide,
  MARKS_HEIGHT,
  NOTE_HEIGHT,
  cardSwatchSize,
  smallLabelFit,
  TIER_FACES,
} from '@/ui/theme/columnBoard';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * One button in a team's column, in the operator's words already (the sport's screen translates its own board): its id
 * goes back to the caller; the primary one is the lime Goal square, which carries the column's score; a disabled one may
 * say why, on the line under the squares. `said` is what a screen reader hears when it is more than the word ("Goal, Home
 * FC, 2"); `mark` is what a small square draws over its word (a card's swatch, or the two arrows of Sub) and puts the
 * button in the row of three.
 */
export type TeamAction = {
  readonly id: string;
  readonly label: string;
  readonly said: string | null;
  readonly primary: boolean;
  readonly enabled: boolean;
  readonly note: string | null;
  readonly mark: 'caution' | 'dismissal' | 'sub' | null;
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
  /**
   * Whether the note line's room stands under the squares when this column has no note (default yes). The screen says no
   * when neither column has one, so the card ends under its buttons, not a line past them; both cards then agree.
   */
  readonly reserveNote?: boolean;
};

/**
 * A team's column on a pad whose score is not a tap (S2-5 design §6.2, rulings 105, 132 and 144): the name as typed heads it
 * (two lines, then an ellipsis, a fixed height so two columns line up), then one line of marks (a card icon per colour
 * with its count, then the sport's tags), then the buttons, every one a square: the lime Goal square as wide as the column
 * (its height permitting, else the square shrinks to the height and is centred) with the score as its numeral and its word
 * under it, a row of three small squares (Yellow, Red and Sub, each a mark over its word) and the note line a disabled
 * one may use. A column too narrow for three touch targets (under about 160 dp) keeps the squares' 48 dp height, so they
 * are near-square (ruling 145). Any other button (Missed) is a full-width row. A kit part with no sport named (the
 * controller's ruling 5). A screen reader hears the name and the marks as one, then each button; the square says its score.
 *
 * The controller's fix-round rulings: the name shrinks to fit before its ellipsis, so no word breaks at a letter (a);
 * the marks' row is one line of fixed height, so the buttons never move (b); the numeral shrinks to fit its line and is
 * never cut (f), and scales with the square it is in (138). Compact (R1) sets the name on one line, so a short phone
 * keeps a touch target per button. footballFit.test.ts holds the numbers.
 */
export const TeamColumn = memo(function TeamColumn({
  view,
  onAction,
  compact,
  reserveNote = true,
}: TeamColumnProps) {
  const tier: BoardTier = compact === true ? 'compact' : 'full';
  const squares = view.actions.filter((action) => action.mark !== null);
  const note = squares.find((action) => action.note !== null)?.note ?? null;
  return (
    <View testID="team-column" style={columnStyle(view.bar, tier)}>
      <ColumnHead view={view} tier={tier} />
      {view.actions.map((action) =>
        action.primary ? (
          <GoalSquare
            key={action.id}
            action={action}
            value={view.value}
            tier={tier}
            onAction={onAction}
          />
        ) : null,
      )}
      {squares.length === 0 ? null : (
        <>
          <View testID="column-cards" style={styles.smallRow}>
            {squares.map((square) => (
              <SmallSquare key={square.id} action={square} onAction={onAction} />
            ))}
          </View>
          {note === null && !reserveNote ? null : (
            <View testID="column-note-room" style={styles.noteRoom}>
              {note === null ? null : (
                <Text
                  testID="column-note"
                  aria-hidden
                  variant="metricUnit"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={layout.noteFloor}
                  style={styles.note}
                >
                  {note}
                </Text>
              )}
            </View>
          )}
        </>
      )}
      {view.actions.map((action) =>
        !action.primary && action.mark === null ? (
          <ColumnButton key={action.id} action={action} onAction={onAction} />
        ) : null,
      )}
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

/** What a screen reader hears: the sport's words if it gave them, else the label, then the note under it. */
const nameOf = (action: TeamAction): string => {
  const base = action.said ?? action.label;
  return action.note === null ? base : `${base}, ${action.note}`;
};

type GoalSquareProps = ColumnButtonProps & {
  readonly value: string;
  readonly tier: BoardTier;
};

/**
 * The primary button, the lime plate with night ink (AGENTS §5): a square as wide as the column, its height permitting
 * (`goalSide`), centred in the room the column leaves it, with the team's score as its numeral and the word under it.
 * The numeral scales with the measured square and shrinks to fit its line, down to `layout.scoreFloor`, never cut.
 */
const GoalSquare = memo(function GoalSquare({ action, value, tier, onAction }: GoalSquareProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  const off = !action.enabled;
  const [room, setRoom] = useState({ width: goalHeight(tier), height: goalHeight(tier) });
  const measured = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRoom({ width: Math.round(width), height: Math.round(height) });
  }, []);
  // The room is as tall as it is wide and gives way (flexShrink) when the column is held shorter than that, so a column
  // hugs its square and the spare height sits outside the card (owner ruling 152); its height follows its width only.
  const roomStyle = useMemo(() => [GOAL_ROOM[tier], { height: room.width }], [tier, room.width]);
  const side = goalSide(room);
  const size = goalNumeralSize(tier, side);
  const fit = useMemo(() => ({ fontSize: size, lineHeight: Math.round(size * 1.06) }), [size]);
  const box = useMemo(() => ({ width: side, height: side }), [side]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.square,
      off ? styles.squareOff : null,
      pressed && !off ? styles.pressedPlate : null,
      box,
    ],
    [off, box],
  );
  return (
    <View testID="goal-room" onLayout={measured} style={roomStyle}>
      <Pressable
        testID="goal-square"
        accessibilityRole="button"
        accessibilityLabel={nameOf(action)}
        disabled={off}
        onPress={press}
        style={style}
      >
        <Text
          testID="column-value"
          aria-hidden
          variant={TIER_FACES[tier].numeral}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={layout.scoreFloor}
          style={[styles.numeral, fit, off ? styles.labelOff : styles.labelPrimary]}
        >
          {value}
        </Text>
        <Text
          aria-hidden
          variant="goalWord"
          numberOfLines={1}
          style={off ? styles.labelOff : styles.labelPrimary}
        >
          {action.label}
        </Text>
      </Pressable>
    </View>
  );
});

/**
 * Yellow, Red or Sub: one of three equal squares outlined on the column's surface. Yellow and Red are the card colour
 * alone, a portrait card as large as the square holds (`cardSwatchSize`, owner ruling 163): no word, the screen-reader name
 * says it. Sub is its two arrows over its word, whose size is computed from the square (`smallLabelFit`). A disabled one is
 * dimmed whole.
 */
const SmallSquare = memo(function SmallSquare({ action, onAction }: ColumnButtonProps) {
  const press = useCallback(() => onAction(action.id), [onAction, action.id]);
  const off = !action.enabled;
  // Sized from the square as laid out, not left to the runtime's shrink, which did not run on the NE2211 (build 1060:
  // "YELLO"); 0 until the first layout.
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const measured = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRoom({ width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 });
  }, []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nameOf(action)}
      disabled={off}
      onPress={press}
      onLayout={measured}
      style={off ? smallOff : smallOn}
    >
      {action.mark === 'sub' ? (
        <SubMark label={action.label} side={room.width} />
      ) : (
        <CardSwatch mark={action.mark} room={room} />
      )}
    </Pressable>
  );
});

/** Yellow's or Red's card, in the pad's card colours (AGENTS section 5), sized from its square. */
const CardSwatch = memo(function CardSwatch({
  mark,
  room,
}: {
  readonly mark: TeamAction['mark'];
  readonly room: { readonly width: number; readonly height: number };
}) {
  const style = useMemo(
    () => [
      mark === 'dismissal' ? styles.dismissal : styles.caution,
      styles.swatch,
      cardSwatchSize(room),
    ],
    [mark, room],
  );
  return <View testID="card-swatch" style={style} />;
});

/** Sub: the two arrows over its word, the word sized from the square. */
const SubMark = memo(function SubMark({
  label,
  side,
}: {
  readonly label: string;
  readonly side: number;
}) {
  const fit = smallLabelFit(side, label);
  const word = useMemo(
    () => [styles.smallLabel, { fontSize: fit.fontSize, paddingHorizontal: fit.inset }],
    [fit.fontSize, fit.inset],
  );
  return (
    <>
      <SubGlyph />
      <Text variant="diagSection" numberOfLines={1} style={word}>
        {label}
      </Text>
    </>
  );
});

/** Sub's glyph: an arrow right over an arrow left, each a bar and a head made from a box with no width. */
const SubGlyph = memo(function SubGlyph() {
  return (
    <View testID="sub-glyph" style={styles.subGlyph}>
      <View style={styles.subArrow}>
        <View style={styles.subBar} />
        <View style={styles.subHeadRight} />
      </View>
      <View style={styles.subArrow}>
        <View style={styles.subHeadLeft} />
        <View style={styles.subBar} />
      </View>
    </View>
  );
});

/** A team's other button (Missed): a full-width row on `surface2`, a touch target tall; a disabled one greys. */
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
  // The card hugs its content (owner ruling 152): it does not grow into spare height, it gives way when the board is short.
  column: {
    flexShrink: 1,
    minWidth: 0,
    padding: space.sm,
    borderRadius: radius.card,
    // The colour bar is the column's top edge, following its rounded corners (owner ruling 147, the mockup).
    borderTopWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  gapFull: { gap: TIER_FACES.full.gap },
  gapCompact: { gap: TIER_FACES.compact.gap },
  lit: { borderTopColor: colour.lime },
  dim: { borderTopColor: colour.ink3 },
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
  // The Goal square's room takes what the column's other rows leave, at least the tier's least (`goalHeight`); the square
  // is as wide as the column or as tall as the room, centred (ruling 144), its side set from the measured room.
  goalRoom: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalRoomFull: { minHeight: goalHeight('full') },
  goalRoomCompact: { minHeight: goalHeight('compact') },
  square: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.card,
    backgroundColor: colour.lime,
  },
  squareOff: { backgroundColor: colour.surface2 },
  // No Android font padding over the big digits (it is an empty band above them; device-only).
  numeral: { flexShrink: 1, includeFontPadding: false },
  // Three equal squares: a third of the column each, as tall as they are wide, but never under a touch target, so a column
  // under about 160 dp keeps 48 dp and they are near-square (controller ruling 145).
  smallRow: { flexDirection: 'row', gap: space.xs },
  small: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.touch,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: layout.padSubGap,
    borderRadius: radius.card,
    // Outlined as the mockup's `.pb.outl`, on the column's own surface (owner ruling 152).
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  // A disabled square is the whole square dimmed (the mockup's `.pb.dim`), by the token.
  smallDim: { opacity: layout.disabledMark },
  swatch: { borderRadius: layout.padCardRadius },
  smallLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    letterSpacing: layout.padSquareLabelSpacing,
    color: colour.ink,
  },
  noteRoom: { height: NOTE_HEIGHT, justifyContent: 'center' },
  subGlyph: { gap: layout.padSubGap },
  subArrow: { flexDirection: 'row', alignItems: 'center' },
  subBar: { width: layout.padSubBar, height: layout.padSubThickness, backgroundColor: colour.ink },
  // An arrow's head: a box with no width whose one side's border is the point and whose top and bottom are clear.
  subHeadRight: {
    width: 0,
    height: 0,
    borderTopWidth: layout.padSubHalf,
    borderBottomWidth: layout.padSubHalf,
    borderLeftWidth: layout.padSubHead,
    borderTopColor: colour.clear,
    borderBottomColor: colour.clear,
    borderLeftColor: colour.ink,
  },
  subHeadLeft: {
    width: 0,
    height: 0,
    borderTopWidth: layout.padSubHalf,
    borderBottomWidth: layout.padSubHalf,
    borderRightWidth: layout.padSubHead,
    borderTopColor: colour.clear,
    borderBottomColor: colour.clear,
    borderRightColor: colour.ink,
  },
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
  note: { textAlign: 'center', color: colour.ink2 },
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
const GOAL_ROOM: Record<BoardTier, StyleProp<ViewStyle>> = {
  full: [styles.goalRoom, styles.goalRoomFull],
  compact: [styles.goalRoom, styles.goalRoomCompact],
};

const cautionCard = [styles.card, styles.caution];
const dismissalCard = [styles.card, styles.dismissal];
const smallOn = pressable(styles.small, styles.pressedOther);
const smallOff: StyleProp<ViewStyle> = [styles.small, styles.smallDim];
const otherButton = pressable(styles.button, styles.pressedOther);
const otherOff: StyleProp<ViewStyle> = styles.button;
