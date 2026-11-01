import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { divisionAndRound, type MatchContext } from '@/domain/scoring/matchContext';
import { SIDES } from '@/domain/session/matchLabel';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Where a match sits, for any sport (owner, 2026-11-01: "How do we know Comp/Divi round etc.?"): the competition in
 * the display face, the division and round on one line, the match's code, then the sides as typed, joined as the
 * match label joins them (C2: " v " with the v in ink2). The organiser's words, never translated. A line with nothing
 * to say is not drawn. Long names wrap and are never cut: the block's parent scrolls.
 */
export const MatchDetails = memo(function MatchDetails({
  context,
}: {
  readonly context: MatchContext;
}) {
  const where = divisionAndRound(context);
  return (
    <View testID="match-details" style={styles.block}>
      <Text testID="details-competition" variant="label">
        {context.competition}
      </Text>
      {where === null ? null : (
        <Text testID="details-where" variant="control">
          {where}
        </Text>
      )}
      {context.match === null || context.match.trim() === '' ? null : (
        <Text testID="details-match" variant="control">
          {context.match}
        </Text>
      )}
      <Text testID="details-sides" variant="label">
        {context.sides[0]}
        <Text variant="label" style={styles.v}>
          {SIDES}
        </Text>
        {context.sides[1]}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  v: { color: colour.ink2 },
});
