import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { useBackToViewfinder } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import type { ControlSide, StreamSettings } from '@/services/streamSettingsStore';
import { ChoiceRow } from '@/ui/components/ChoiceRow';
import { GhostButton } from '@/ui/components/GhostButton';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/** D22: shipped and linked native code, and the one source link MPL-2.0 asks for. */
const LICENCES: readonly { readonly name: string; readonly licence: string }[] = [
  { name: 'libsrt', licence: 'MPL-2.0' },
  { name: 'StreamPack', licence: 'Apache-2.0' },
  { name: 'react-native-webview', licence: 'MIT' },
  { name: 'expo-video', licence: 'MIT' },
  { name: 'React Native', licence: 'MIT' },
  { name: 'Expo', licence: 'MIT' },
];
const LIBSRT_SOURCE = 'https://github.com/Haivision/srt';

/**
 * Spec §4's Settings, inside Live Stream so it is reachable on air (AGENTS §6).
 * Neither choice disturbs a live broadcast — the score preview is this phone's
 * only, and the side moves only the controls — so nothing here is disabled on
 * air. The encode profile, when it comes, is the first that will be.
 */
export function SettingsScreen() {
  const { t } = useT();
  const toCamera = useBackToViewfinder();
  const { settings, change, saveFailed } = useStreamSettings();
  const toggleOverlay = useCallback(
    () => change({ overlay: !settings.overlay }),
    [change, settings.overlay],
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SubScreenHeader title={t('settings.title')} onBack={toCamera} />
      <ChoiceRow
        label={t('settings.overlay.label')}
        role="switch"
        checked={settings.overlay}
        onPress={toggleOverlay}
      />
      <Text variant="metricUnit">{t('settings.overlay.hint')}</Text>
      <SideChoice side={settings.side} change={change} />
      <Text variant="control">{t('settings.power.label')}</Text>
      <Text variant="body">{t('settings.power.advice')}</Text>
      <Licences />
      {saveFailed ? <Text variant="status">{t('settings.saveFailed')}</Text> : null}
    </ScrollView>
  );
}

/**
 * Controls on the left or the right: a pair of radios. Takes the screen's own
 * `change`, so a refused save says so in the one place the screen shows it.
 */
function SideChoice({
  side,
  change,
}: {
  side: ControlSide;
  change: (next: Partial<StreamSettings>) => void;
}) {
  const { t } = useT();
  const toLeft = useCallback(() => change({ side: 'left' }), [change]);
  const toRight = useCallback(() => change({ side: 'right' }), [change]);
  return (
    <View style={styles.side}>
      <Text variant="control">{t('settings.side.label')}</Text>
      <View style={styles.pair}>
        <ChoiceRow
          label={t('settings.side.left')}
          role="radio"
          checked={side === 'left'}
          onPress={toLeft}
        />
        <ChoiceRow
          label={t('settings.side.right')}
          role="radio"
          checked={side === 'right'}
          onPress={toRight}
        />
      </View>
    </View>
  );
}

function Licences() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return (
    <View style={styles.licences}>
      <GhostButton label={t('settings.licences.label')} onPress={toggle} expanded={open} />
      {open
        ? LICENCES.map((entry) => (
            <Text key={entry.name} variant="metricUnit">
              {t('settings.licences.entry', entry)}
            </Text>
          ))
        : null}
      {open ? (
        <Text variant="metricUnit">{t('settings.licences.source', { url: LIBSRT_SOURCE })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  content: { gap: space.sm, padding: space.md },
  side: { gap: space.xs },
  pair: { flexDirection: 'row', gap: space.sm },
  licences: { gap: space.xs },
});
