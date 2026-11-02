import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { screenLayout } from '@/domain/mode/homeLayout';
import { useT } from '@/hooks/useLanguage';
import { useBackToViewfinder } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { ChoiceRow } from '@/ui/components/ChoiceRow';
import { DiagnosticsCard } from '@/ui/components/DiagnosticsCard';
import { PowerRow } from '@/ui/components/PowerRow';
import { RecordRow } from '@/ui/components/RecordRow';
import { SideChoice } from '@/ui/components/SideChoice';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { TextLink } from '@/ui/components/TextLink';
import { FEATURES } from '@/ui/features';
import { layoutMarker } from '@/ui/layoutMarker';
import { LIBSRT_SOURCE, LICENCES } from '@/ui/licences';
import { colour, layout as metrics, space } from '@/ui/theme/tokens';

/**
 * Spec §4's Settings, inside Live Stream so it is reachable on air (AGENTS §6).
 * The side does not disturb a live broadcast — it moves only the controls — so
 * nothing here is disabled on air. The encode profile, when it comes, is the first that will be.
 * Start and stop automatically stays usable on air, the one named exception
 * to AGENTS §6's rule: it only affects the automatic stop (amendment §2).
 * `useEngineSync` (in the shell) tells native when it changes.
 *
 * Spec §6: the Diagnostics card is here, after the settings. Portrait is one
 * scrolling column; landscape is two halves, the settings and the card, each
 * scrolling on its own (a 360 dp tall phone cannot hold the whole card under
 * the header), with the way back across the top. The root says
 * which in `data-layout`, the marker the tests read.
 *
 * R5: the battery row follows the power paragraph, on Android only. N33: the record row follows it, Share record and,
 * with its switch on, Send record to Seazn (R3).
 *
 * Home's gear opens the app's own Settings (`AppSettingsScreen`, owner 2026-11-02), which holds the same two phone
 * settings, the battery row and the record row in designed rows. This one is only Live Stream's.
 */
type SettingsScreenProps = {
  /** R3: Send record to Seazn in the record row. `FEATURES.recordSend` (on, the owner's ruling of 2026-10-12). */
  readonly recordSend?: boolean;
};

export function SettingsScreen({ recordSend = FEATURES.recordSend }: SettingsScreenProps) {
  const { t } = useT();
  const { width, height } = useWindowDimensions();
  const layout = screenLayout(width, height);
  const toCamera = useBackToViewfinder();
  const { settings, change, saveFailed } = useStreamSettings();
  const toggleAutomatic = useCallback(
    () => change({ automatic: !settings.automatic }),
    [change, settings.automatic],
  );
  const header = <SubScreenHeader title={t('settings.title')} onBack={toCamera} />;
  const controls = (
    <>
      <ChoiceRow
        label={t('settings.automatic.label')}
        checked={settings.automatic}
        onPress={toggleAutomatic}
      />
      <Text variant="metricUnit">{t('settings.automatic.hint')}</Text>
      <SideChoice side={settings.side} change={change} />
      <Text variant="metricUnit">{`${t('settings.power.label')} — ${t('settings.power.advice')}`}</Text>
      <PowerRow />
      <RecordRow send={recordSend} />
      <Licences />
      {saveFailed ? <Text variant="status">{t('settings.saveFailed')}</Text> : null}
    </>
  );
  if (layout === 'landscape') {
    return (
      <View {...layoutMarker('settings', layout)} style={styles.landscape}>
        {header}
        <View testID="settings-halves" style={styles.halves}>
          <ScrollView style={styles.half} contentContainerStyle={styles.controls}>
            {controls}
          </ScrollView>
          <ScrollView style={styles.half}>
            <DiagnosticsCard />
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <View {...layoutMarker('settings', layout)} style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.column}>
        {header}
        <View style={styles.controls}>{controls}</View>
        <DiagnosticsCard />
      </ScrollView>
    </View>
  );
}

function Licences() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return (
    <View style={styles.licences}>
      <TextLink label={t('settings.licences.label')} onPress={toggle} expanded={open} />
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
  /** Portrait: the header, the settings, then the card, in one column. */
  column: { gap: space.md, padding: space.md },
  /** The settings' own rhythm, in a column of its own or a half's scroller. */
  controls: { gap: space.sm },
  /** Landscape: a smaller vertical pad (board "Settings, landscape"), the header over two halves. */
  landscape: {
    flex: 1,
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: metrics.settingsPadV,
    backgroundColor: colour.ground,
  },
  halves: { flex: 1, flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  licences: { gap: space.xs },
});
