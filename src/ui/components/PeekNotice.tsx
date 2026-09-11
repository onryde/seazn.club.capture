import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Stands in for a preview that cannot run. Says what is missing rather than
 * showing a blank — §6's rule applies hardest when something is wrong.
 */
export function PeekNotice({ visible, message }: { visible: boolean; message: string }) {
  return (
    <View style={[styles.clip, visible ? null : styles.hidden]} pointerEvents="none">
      <Text variant="body" style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.ground,
    padding: space.xl,
  },
  hidden: {
    opacity: 0,
  },
  message: {
    textAlign: 'center',
    maxWidth: 360,
  },
});
