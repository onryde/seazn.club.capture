import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSettings } from '@/hooks/useSettings';
import { LivePlate } from '@/ui/components/LivePlate';
import { Text } from '@/ui/components/Text';
import { Toggle } from '@/ui/components/Toggle';
import { colour, space, status } from '@/ui/theme/tokens';

/**
 * "A bit of settings" (AGENTS.md §1) — and no more than that. Every row here
 * changes something an operator at a ground would actually need to change, and
 * every row actually works: a control that looks live and does nothing is worse
 * than no control at all.
 *
 * Reachable while live (§6), with a LIVE plate beside the way back so the
 * broadcast is never out of sight. The rule that comes with that: **a setting
 * that would disturb a live broadcast is disabled while live, with a one-line
 * reason** — the screen is not withheld, the individual control is. Both rows
 * below are safe to change mid-match (one gates a preview the operator has to
 * hold anyway, the other moves this column), so neither is disabled. The first
 * row that is not safe will be the encode profile, which restarts the publish:
 * that one lands here with `disabled` set from the engine's on-air state and its
 * reason on the row. `Toggle` already carries `disabled`; the reason line is the
 * only thing to add, and it should be added with the row that needs it rather
 * than as a prop nothing passes.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { settings, update, persistent } = useSettings();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.backRow}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
          <Text variant="control">Back to viewfinder</Text>
        </Pressable>
        <LivePlate />
      </View>

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
  // The plate sits opposite the way back: both are read on arrival, and the
  // operator should not have to hunt for whether the match is still going out.
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
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
