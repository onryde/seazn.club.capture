import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type MatchRowProps = {
  /** The row's label in its column at the left (Now, Next, Then); none for a row under a section's heading. */
  readonly label?: string;
  /** What a screen reader hears first when no label is drawn (Finished, under its heading). */
  readonly spoken?: string;
  /** "Ng v Brown": one line, cut with an ellipsis, so a card never grows. */
  readonly names: string;
  /** At the right, never cut: the planned time or the score; none when the server has neither. */
  readonly detail: string | null;
  /** A finished match: drawn in the inert ink. */
  readonly dim?: boolean;
  /** Task 5 opens a match from its row; an online board's row never gets one (S4 design §5). */
  readonly onPress?: () => void;
};

/**
 * One match on Match Day's list (S4 design §5): its label, its names and its time or score, in one row of at least
 * `touch` height, so the row is already the size of the target it becomes when it opens its match. One stop for a
 * screen reader, read as one line ("Now, Ng v Brown, 14-9"). Without `onPress` it is not a control at all.
 */
export const MatchRow = memo(function MatchRow(props: MatchRowProps) {
  const said = [props.label ?? props.spoken, props.names, props.detail]
    .filter((part): part is string => part !== undefined && part !== null)
    .join(', ');
  const body = <RowBody {...props} />;
  if (props.onPress === undefined)
    return (
      <View testID="match-row" accessible accessibilityLabel={said} style={styles.row}>
        {body}
      </View>
    );
  return (
    <Pressable
      testID="match-row"
      accessibilityRole="button"
      accessibilityLabel={said}
      onPress={props.onPress}
      style={pressableRow}
    >
      {body}
    </Pressable>
  );
});

const RowBody = memo(function RowBody({ label, names, detail, dim = false }: MatchRowProps) {
  return (
    <>
      {label === undefined ? null : (
        <Text variant="diagSection" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      )}
      <Text variant="controlInk" numberOfLines={1} style={dim ? styles.namesDim : styles.names}>
        {names}
      </Text>
      {detail === null ? null : (
        <Text variant="diagValue" style={dim ? styles.detailDim : styles.detail}>
          {detail}
        </Text>
      )}
    </>
  );
});

/** Module-level so render allocates no function: a pressed row takes the press fill. */
function pressableRow({ pressed }: { pressed: boolean }) {
  return pressed ? [styles.row, styles.pressed] : styles.row;
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  pressed: { backgroundColor: colour.pressFill },
  label: { width: layout.matchDayRowLabel, color: colour.ink2 },
  names: { flex: 1, minWidth: 0, color: colour.ink },
  namesDim: { flex: 1, minWidth: 0, color: colour.ink3 },
  detail: { flexShrink: 0, color: colour.ink },
  detailDim: { flexShrink: 0, color: colour.ink3 },
});
