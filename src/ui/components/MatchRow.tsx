import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NamePart } from '@/domain/matchday/matchDay';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type MatchRowProps = {
  /**
   * The round chip (the desk's tag, SF·1; task 8d-B, F-T8-3): on the names' line, just before the names, in every row
   * kind alike (owner, 2026-11-13: "fix chip placement", after the device pass showed it over Next's label but beside a
   * finished row's names). None when the row has no tag and no round.
   */
  readonly chip?: string | null;
  /** The row's label in its column at the left (Now, Next, Then); none for a row under a section's heading. */
  readonly label?: string;
  /** What a screen reader hears first when no label is drawn (Finished, under its heading). */
  readonly spoken?: string;
  /** "Ng v Brown": one line, cut with an ellipsis, so a card never grows. */
  readonly names: string;
  /**
   * The names in pieces, when a seat shows the words of what it waits for ("Winner of SF·1", task 8d-B, F-T8-4): those
   * in the inert ink beside the entrant's name in cream. Null draws `names` whole. Never changes what is read.
   */
  readonly parts?: readonly NamePart[] | null;
  /**
   * At the right: the planned time or the score; none when the server has neither. One line, as wide as it needs until
   * the names are down to `matchDayNamesMin`, then cut with an ellipsis (review I2: the server's score can be the whole
   * scoreboard headline).
   */
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
  const said = [props.chip, props.label ?? props.spoken, props.names, props.detail]
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

const RowBody = memo(function RowBody({
  chip = null,
  label,
  names,
  parts = null,
  detail,
  dim = false,
}: MatchRowProps) {
  return (
    <>
      {label === undefined ? null : (
        <Text variant="diagSection" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      )}
      {chip === null ? null : <RoundChip tag={chip} />}
      <Text variant="rowNames" numberOfLines={1} style={dim ? styles.namesDim : styles.names}>
        {parts === null ? names : parts.map(partOf)}
      </Text>
      {detail === null ? null : (
        <Text variant="diagValue" numberOfLines={1} style={dim ? styles.detailDim : styles.detail}>
          {detail}
        </Text>
      )}
    </>
  );
});

/** A seat's words (inert ink) or the template's, keyed by its place: the parts of one row never reorder. */
function partOf(part: NamePart, index: number) {
  return part.dim ? (
    <Text key={index} variant="rowNames" style={styles.slot}>
      {part.text}
    </Text>
  ) : (
    part.text
  );
}

/** The round chip: the tag in caps on a hairlined plate, whole (it never shrinks; the names give way). */
const RoundChip = memo(function RoundChip({ tag }: { readonly tag: string }) {
  return (
    <View testID="round-chip" style={styles.chip}>
      <Text variant="diagSection" numberOfLines={1} style={styles.chipWord}>
        {tag}
      </Text>
    </View>
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
  chip: {
    flexShrink: 0,
    paddingHorizontal: space.xs,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface2,
  },
  chipWord: { color: colour.ink2 },
  slot: { color: colour.ink3 },
  names: { flex: 1, minWidth: layout.matchDayNamesMin, color: colour.ink },
  namesDim: { flex: 1, minWidth: layout.matchDayNamesMin, color: colour.ink3 },
  detail: { flexShrink: 1, minWidth: 0, color: colour.ink },
  detailDim: { flexShrink: 1, minWidth: 0, color: colour.ink3 },
});
