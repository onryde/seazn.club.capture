import { memo, type ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** What a card's edge says: caution orange when something is wrong, lime when it is done, lilac when there is only nothing to do yet. */
export type Edge = 'caution' | 'lime' | 'quiet';

/**
 * The scoring screens' card: a surface with a bar down its left edge whose colour is the card's meaning (never red: red
 * means ON AIR, AGENTS §5). The pad's state cards and the states that stand in place of the pad (`ScoringStateCard`)
 * are this one card, so the two read as one family. Said politely when it appears, since a card is what changed.
 */
export const EdgeCard = memo(function EdgeCard({
  edge,
  testID,
  children,
}: {
  readonly edge: Edge;
  readonly testID: string;
  readonly children: ReactNode;
}) {
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={EDGE[edge]}>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  caution: { borderLeftColor: colour.caution },
  lime: { borderLeftColor: colour.lime },
  quiet: { borderLeftColor: colour.ink3 },
});

const EDGE: Readonly<Record<Edge, StyleProp<ViewStyle>>> = {
  caution: [styles.card, styles.caution],
  lime: [styles.card, styles.lime],
  quiet: [styles.card, styles.quiet],
};
