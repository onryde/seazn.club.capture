import { StyleSheet, View } from 'react-native';
import { selectIsOnAir } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import { plate, plateInk, space } from '@/ui/theme/tokens';

/**
 * Proof the broadcast is still running while the operator is looking at
 * something else.
 *
 * Settings and Diagnostics stay reachable on air (AGENTS.md §6) — mid-match is
 * exactly when somebody needs Diagnostics — so each of those screens carries
 * the viewfinder's own state plate in miniature: same plate colour, same night
 * ink, same display caps. A second vocabulary for "live" would be a second
 * authority on the most important word in the app.
 *
 * Subscribes rather than taking a prop, like `Elapsed`: two screens asking the
 * same question of the engine is one place where it can be answered differently.
 * Renders nothing off air, so a screen can place it unconditionally.
 */
export function LivePlate() {
  const onAir = useEngineSelector(selectIsOnAir);
  if (!onAir) return null;

  return (
    <View style={styles.plate}>
      <Text variant="state" style={styles.ink}>
        Live
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Small: this is a reassurance, not the tally. The viewfinder owns the plate
  // that has to read unfocused from two metres.
  plate: {
    alignSelf: 'flex-start',
    backgroundColor: plate.live,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  ink: {
    color: plateInk,
  },
});
