import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * A team's kicks in a shootout, in the order taken (S2-5 design §6.5): a lime dot for a kick scored, a lilac ring for
 * one missed. Drawings, never glyphs, so no face can lack them; a screen reader hears the count ("3 scored of 4"). A kit
 * part with no sport named. Before the team's first kick it is an empty row of the same height, so nothing moves when
 * the first mark arrives.
 */
export const KickRow = memo(function KickRow({ kicks }: { readonly kicks: readonly boolean[] }) {
  const { t } = useT();
  const scored = kicks.filter(Boolean).length;
  return (
    <View
      testID="kick-row"
      accessible
      accessibilityLabel={t('scoring.pad.kicks.said', { scored, taken: kicks.length })}
      style={styles.row}
    >
      {kicks.map((kick, at) =>
        // A kick's place is its identity: kicks are only ever added at the end, or the last taken back.
        kick ? (
          <View key={at} testID="kick-scored" style={scoredMark} />
        ) : (
          <View key={at} testID="kick-missed" style={missedMark} />
        ),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.kickMark,
  },
  mark: {
    width: layout.kickMark,
    height: layout.kickMark,
    borderRadius: layout.kickMark / 2,
    borderWidth: layout.iconBorder,
  },
  scored: { borderColor: colour.lime, backgroundColor: colour.lime },
  missed: { borderColor: colour.ink3 },
});

const scoredMark = [styles.mark, styles.scored];
const missedMark = [styles.mark, styles.missed];
