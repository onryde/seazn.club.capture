import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colour } from '@/ui/theme/tokens';

/**
 * The one UI file allowed to touch safe-area insets; screens stay inset-free
 * so they render on react-native-web in tests. All four edges: Android 16 is
 * edge-to-edge and the nav bar can sit on any side in landscape (found on a
 * OnePlus 10 Pro: text ran 28dp under it).
 */
const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

export function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={ALL_EDGES}>
      <StatusBar style="light" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.ground },
});
