import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TurnCardKind } from '@/domain/orientation/orientation';
import { TurnGlyph } from '@/ui/components/TurnGlyph';
import { colour } from '@/ui/theme/tokens';

/**
 * Covers the app until the phone is held the right way (spec §5). Glyph only,
 * by the owner's ruling R28: the turning phone outline is the whole
 * instruction. Screen readers get the words from the root that `OrientationGate`
 * wraps it in. Rendered under a lock that follows the hands, so it reads
 * upright in them (R24); on air the lock stays put and it may read sideways.
 */
export const TurnCard = memo(function TurnCard({ card }: { card: TurnCardKind }) {
  return (
    <View style={styles.card}>
      <TurnGlyph card={card} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.ground,
  },
});
