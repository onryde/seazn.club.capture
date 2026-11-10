import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { isBoundary, type SheetExtra } from '@/domain/scoring/cricketExtras';
import type { CricketPadActions } from '@/hooks/useCricketMatch';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * The cricket pad's keys (S2-4 spec §5 rows 5 to 7; rulings 73, 79, 80, 81; plan Task 11), under the board: the runs, 0 1
 * 2 and 3 4 6, two rows of three, the 4 and the 6 boundaries in lime; the extras, Wide, No-ball, Bye and Leg-bye, each
 * opening its sheet; and Out (the caution outline), Undo and More, three equal, each word whole on two lines at most. Each row is a fixed height (`layout`),
 * so a ball never moves a key under the thumb. While a sheet is over the pad every key is disabled (the web's lesson: a
 * key under a sheet must not record). Undo takes back this phone's own last tap (ruling 81), enabled only when there is
 * one (`undo`); it is gone with the pad's Undo once a result's window has closed (`undoCell`).
 */
export const CricketKeys = memo(function CricketKeys({
  undo,
  undoCell,
  onMore,
  disabled,
  actions,
}: {
  readonly undo: boolean;
  readonly undoCell: boolean;
  /** More's sheet, when it has anything to offer now; greyed when none. */
  readonly onMore: (() => void) | null;
  readonly disabled: boolean;
  readonly actions: CricketPadActions;
}) {
  return (
    <View testID="cricket-keys" style={styles.keys}>
      <RunRow testID="keys-runs-first" runs={FIRST_RUNS} disabled={disabled} onRun={actions.run} />
      <RunRow
        testID="keys-runs-second"
        runs={SECOND_RUNS}
        disabled={disabled}
        onRun={actions.run}
      />
      <View testID="keys-extras" style={styles.extrasRow}>
        {EXTRAS.map((extra) => (
          <ExtraKey key={extra} extra={extra} disabled={disabled} onOpen={actions.openExtras} />
        ))}
      </View>
      <View testID="keys-actions" style={styles.actionsRow}>
        <ActionKey
          label="scoring.cricket.key.out"
          look="out"
          disabled={disabled}
          onPress={actions.openOut}
        />
        {undoCell ? (
          <ActionKey
            label="scoring.pad.undo"
            look="plain"
            disabled={disabled || !undo}
            onPress={actions.undo}
          />
        ) : (
          <View style={styles.cell} />
        )}
        <ActionKey
          label="scoring.cricket.key.more"
          look="plain"
          disabled={disabled || onMore === null}
          onPress={onMore ?? noMore}
        />
      </View>
    </View>
  );
});

const noMore = (): void => undefined;

const FIRST_RUNS = [0, 1, 2] as const;
const SECOND_RUNS = [3, 4, 6] as const;
const EXTRAS: readonly SheetExtra[] = ['wide', 'noball', 'bye', 'legbye'];

const EXTRA_LABEL: Readonly<Record<SheetExtra, MessageKey>> = {
  wide: 'scoring.cricket.key.wide',
  noball: 'scoring.cricket.key.noBall',
  bye: 'scoring.cricket.key.bye',
  legbye: 'scoring.cricket.key.legBye',
};

function RunRow({
  testID,
  runs,
  disabled,
  onRun,
}: {
  readonly testID: string;
  readonly runs: readonly number[];
  readonly disabled: boolean;
  readonly onRun: (runs: number) => void;
}) {
  return (
    <View testID={testID} style={styles.runRow}>
      {runs.map((count) => (
        <RunKey key={count} runs={count} disabled={disabled} onRun={onRun} />
      ))}
    </View>
  );
}

/** A run key: the number, large; a screen reader hears the ball ("Dot ball", "2 runs", "Four"). */
const RunKey = memo(function RunKey({
  runs,
  disabled,
  onRun,
}: {
  readonly runs: number;
  readonly disabled: boolean;
  readonly onRun: (runs: number) => void;
}) {
  const { t, tp } = useT();
  const press = useCallback(() => onRun(runs), [onRun, runs]);
  const boundary = isBoundary(runs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenRun(runs, t, tp)}
      disabled={disabled}
      onPress={press}
      style={disabled ? OFF : boundary ? BOUNDARY : PLAIN}
    >
      <Text
        variant="tally"
        style={disabled ? styles.labelOff : boundary ? styles.lime : styles.ink}
      >
        {String(runs)}
      </Text>
    </Pressable>
  );
});

function spokenRun(
  runs: number,
  t: ReturnType<typeof useT>['t'],
  tp: ReturnType<typeof useT>['tp'],
): string {
  if (runs === 0) return t('scoring.cricket.ball.dot');
  if (runs === 4) return t('scoring.cricket.ball.four');
  if (runs === 6) return t('scoring.cricket.ball.six');
  return tp('scoring.cricket.ball.runs', runs);
}

const ExtraKey = memo(function ExtraKey({
  extra,
  disabled,
  onOpen,
}: {
  readonly extra: SheetExtra;
  readonly disabled: boolean;
  readonly onOpen: (extra: SheetExtra) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onOpen(extra), [onOpen, extra]);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={press}
      style={disabled ? OFF : EXTRA}
    >
      <Text
        variant="actionSecondary"
        numberOfLines={1}
        style={disabled ? styles.labelOff : styles.caution}
      >
        {t(EXTRA_LABEL[extra])}
      </Text>
    </Pressable>
  );
});

type ActionLook = 'out' | 'plain';

const ActionKey = memo(function ActionKey({
  label,
  look,
  disabled,
  onPress,
}: {
  readonly label: MessageKey;
  readonly look: ActionLook;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={disabled ? OFF : ACTION[look]}
    >
      <Text
        variant="actionSecondary"
        numberOfLines={2}
        style={disabled ? styles.labelOff : ACTION_LABEL[look]}
      >
        {t(label)}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  keys: { gap: space.sm },
  runRow: { height: layout.cricketRunKey, flexDirection: 'row', gap: space.sm },
  extrasRow: { height: layout.cricketExtraKey, flexDirection: 'row', gap: space.sm },
  actionsRow: { height: layout.cricketActionKey, flexDirection: 'row', gap: space.sm },
  cell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  boundary: { borderColor: colour.lime },
  extra: { backgroundColor: colour.surface },
  out: { borderColor: colour.caution, borderWidth: layout.iconBorderOn },
  off: { borderColor: colour.rule },
  pressed: { backgroundColor: colour.pressFill },
  ink: { color: colour.ink },
  lime: { color: colour.lime },
  caution: { color: colour.caution },
  labelOff: { color: colour.ink3 },
});

/** Module-level so render allocates no function. Pressed: the cell takes the press fill, as the tool row's outlines. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const PLAIN = pressable(styles.cell);
const BOUNDARY = pressable([styles.cell, styles.boundary]);
const EXTRA = pressable([styles.cell, styles.extra]);
const OFF: StyleProp<ViewStyle> = [styles.cell, styles.off];

const ACTION: Readonly<
  Record<ActionLook, (state: PressableStateCallbackType) => StyleProp<ViewStyle>>
> = {
  out: pressable([styles.cell, styles.out]),
  plain: PLAIN,
};

const ACTION_LABEL: Readonly<Record<ActionLook, StyleProp<TextStyle>>> = {
  out: styles.caution,
  plain: styles.ink,
};
