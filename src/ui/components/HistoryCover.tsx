import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { IconButton } from '@/ui/components/IconButton';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/** One History row in the operator's language (a sport's rows: `badmintonHistory`). */
export type HistoryRowWords = {
  readonly said: string;
  /** The score after the entry, top first ("7–3"), where it moved the score. */
  readonly score: string | null;
  /** "This phone" or "Another scorer". */
  readonly by: string;
  /** "Undone" when Undo took the entry back, which leaves it in its place, struck through. */
  readonly undone: string | null;
  /** "Sending" while it is this phone's tap the server has not accepted yet (design §6.4); null once it has. */
  readonly sending: string | null;
};

export type HistoryGroupWords = {
  readonly heading: string;
  readonly rows: readonly HistoryRowWords[];
};

type HistoryCoverProps = {
  readonly title: string;
  /** Back's accessible name: it closes History. */
  readonly closeLabel: string;
  /** The one line of a match with nothing recorded. */
  readonly empty: string;
  readonly groups: readonly HistoryGroupWords[];
  readonly onClose: () => void;
};

/**
 * History (owner ruling 21, 2026-10-31), view only, for any sport: a cover the full height of the pad, inside the
 * scoring route, with Back and the title across the top and the entries under it, scrolling, newest first under each
 * period's heading. It changes nothing: no Void, no edit. Back and the hardware Back (the caller's `useBackCloses`)
 * close it. Modal to a screen reader: native reads `accessibilityViewIsModal`, react-native-web `aria-modal`.
 */
export const HistoryCover = memo(function HistoryCover({
  title,
  closeLabel,
  empty,
  groups,
  onClose,
}: HistoryCoverProps) {
  return (
    <View testID="history" accessibilityViewIsModal aria-modal style={styles.cover}>
      <View style={styles.header}>
        <IconButton glyph="back" label={closeLabel} onPress={onClose} />
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </View>
      <ScrollView testID="history-list" contentContainerStyle={styles.list}>
        {groups.length === 0 ? (
          <Text variant="body">{empty}</Text>
        ) : (
          groups.map((group, at) => <HistoryGroup key={at} group={group} />)
        )}
      </ScrollView>
    </View>
  );
});

const HistoryGroup = memo(function HistoryGroup({ group }: { readonly group: HistoryGroupWords }) {
  return (
    <View testID="history-group" style={styles.group}>
      <Text variant="state" accessibilityRole="header" style={styles.heading}>
        {group.heading}
      </Text>
      {group.rows.map((row, at) => (
        <HistoryRow key={at} row={row} />
      ))}
    </View>
  );
});

const isWords = (words: string | null): words is string => words !== null;

/**
 * The sentence at the left in at most `padHistoryLines` (struck through and inert when undone), and at the right, in a
 * column of `padHistorySide`, never cut, the score, who recorded it and "Undone" or "Sending". One stop for a screen reader, read as
 * one line: "Rally recorded — A. Sharma, 7–3, This phone". `accessible` groups the children on native;
 * react-native-web drops it.
 */
const HistoryRow = memo(function HistoryRow({ row }: { readonly row: HistoryRowWords }) {
  const label = [row.said, row.score, row.by, row.undone, row.sending].filter(isWords).join(', ');
  return (
    <View testID="history-row" accessible accessibilityLabel={label} style={styles.row}>
      <Text
        testID="history-said"
        variant="control"
        numberOfLines={layout.padHistoryLines}
        style={row.undone === null ? styles.said : styles.saidUndone}
      >
        {row.said}
      </Text>
      <HistoryRowSide row={row} />
    </View>
  );
});

const HistoryRowSide = memo(function HistoryRowSide({ row }: { readonly row: HistoryRowWords }) {
  return (
    <View testID="history-side" style={styles.side}>
      {row.score === null ? null : (
        <Text testID="history-score" variant="metricValue" style={styles.sideWords}>
          {row.score}
        </Text>
      )}
      <Text testID="history-by" variant="metricUnit" style={styles.sideWords}>
        {row.by}
      </Text>
      {row.undone === null ? null : (
        <Text testID="history-undone" variant="metricUnit" style={styles.sideWords}>
          {row.undone}
        </Text>
      )}
      {row.sending === null ? null : (
        <Text testID="history-sending" variant="metricUnit" style={styles.sideWords}>
          {row.sending}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    gap: space.sm,
    padding: space.md,
    backgroundColor: colour.ground,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.touch },
  title: { flexShrink: 1 },
  list: { gap: space.md, paddingBottom: space.md },
  group: { gap: space.xs },
  heading: { color: colour.ink2 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: layout.iconBorder,
    borderBottomColor: colour.surface2,
  },
  said: { flex: 1 },
  saidUndone: { flex: 1, color: colour.ink3, textDecorationLine: 'line-through' },
  side: { width: layout.padHistorySide, alignItems: 'flex-end' },
  sideWords: { textAlign: 'right' },
});
