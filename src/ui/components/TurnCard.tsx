import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TurnCardKind } from '@/domain/orientation/orientation';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { TurnGlyph } from '@/ui/components/TurnGlyph';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Covers the app until the phone is held the right way (spec §5). Rendered
 * under the current lock, so it reads upright in the operator's hands.
 */
export const TurnCard = memo(function TurnCard({ card }: { card: TurnCardKind }) {
  const { t } = useT();
  const sideways = card === 'turnSideways';
  return (
    <View style={styles.card}>
      <TurnGlyph card={card} />
      <Text variant="title" style={styles.centred}>
        {t(sideways ? 'turn.sideways.title' : 'turn.upright.title')}
      </Text>
      <Text variant="body" style={styles.centred}>
        {t(sideways ? 'turn.sideways.body' : 'turn.upright.body')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colour.ground,
  },
  centred: { textAlign: 'center' },
});
