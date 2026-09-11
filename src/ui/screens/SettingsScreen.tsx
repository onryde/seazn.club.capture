import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSettings } from '@/hooks/useSettings';
import { Text } from '@/ui/components/Text';
import { Toggle } from '@/ui/components/Toggle';
import { colour, space, status } from '@/ui/theme/tokens';

/**
 * "A bit of settings" (AGENTS.md §1) — and no more than that. Every row here
 * changes something an operator at a ground would actually need to change, and
 * every row actually works: a control that looks live and does nothing is worse
 * than no control at all.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { settings, update, persistent } = useSettings();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <Text variant="control">Back to viewfinder</Text>
      </Pressable>

      <Text variant="title">Settings</Text>

      <Toggle
        name="Score preview"
        detail="Lets you hold the preview button to see the overlay over your camera, so you can frame around it."
        value={settings.scorePreview}
        onChange={(scorePreview) => update({ scorePreview })}
      />

      <Toggle
        name="Controls on the left"
        detail="Moves this column to the other side. Useful if your right hand is on the tripod pan bar."
        value={settings.controlSide === 'left'}
        onChange={(left) => update({ controlSide: left ? 'left' : 'right' })}
      />

      {persistent ? null : (
        <Text variant="status" style={styles.warning}>
          These choices will not be remembered after the app restarts on this device.
        </Text>
      )}

      <View style={styles.block}>
        <Text variant="body" style={styles.name}>
          Power
        </Text>
        <Text variant="status">
          Use mains power or a large battery pack. Most handsets will not last three hours of
          encoding on their own battery, and a hot phone drops picture quality well before it runs
          out of charge.
        </Text>
      </View>

      <View style={styles.block}>
        <Text variant="body" style={styles.name}>
          Open source
        </Text>
        <Text variant="status">
          HaishinKit.swift — BSD-3-Clause{'\n'}
          StreamPack — Apache-2.0{'\n'}
          libsrt — MPL-2.0
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.ground,
  },
  content: {
    padding: space.xl,
    gap: space.md,
    maxWidth: 620,
  },
  block: {
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: colour.ruleSoft,
    paddingTop: space.md,
  },
  name: {
    color: colour.ink,
  },
  // The only way back, pressed with cold hands.
  back: {
    minHeight: 44,
    justifyContent: 'center',
  },
  warning: {
    color: status.degraded,
  },
});
