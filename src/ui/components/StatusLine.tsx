import { StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';

/**
 * One sentence that is always true (AGENTS.md §6).
 *
 * Never an unexplained spinner: "Uplink lost — holding, 38s left" tells an
 * operator what is happening and how long they have. A spinner tells them the
 * app might be broken.
 */
export function StatusLine({ children }: { children: string }) {
  return (
    <Text variant="status" numberOfLines={3} style={styles.line}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  // No rule of its own: grouping in the column comes from zone boundaries and
  // proximity, not from giving every row the same divider. No inset either: the
  // line sits on the same edge as the title above it, and the screen pads both.
  //
  // Height is reserved for three lines so the block does not jump ~40px
  // between "Live." and a longer sentence — which would move every control
  // below it, including the one being pressed.
  line: {
    minHeight: 57,
  },
});
