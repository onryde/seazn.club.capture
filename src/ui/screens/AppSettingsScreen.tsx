import { useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { screenLayout } from '@/domain/mode/homeLayout';
import { useT } from '@/hooks/useLanguage';
import { usePowerState } from '@/hooks/usePowerState';
import { useBackToHome } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { LanguageRow } from '@/ui/components/LanguageRow';
import { LicencesRow } from '@/ui/components/LicencesRow';
import { BatteryRow, SendRecordRow, ShareRecordRow } from '@/ui/components/SettingsDeviceRows';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/ui/components/SettingsRow';
import { SidePair } from '@/ui/components/SideChoice';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { FEATURES } from '@/ui/features';
import { layoutMarker } from '@/ui/layoutMarker';
import { layout as metrics, colour, space } from '@/ui/theme/tokens';

type AppSettingsScreenProps = {
  /** R3: Send record to Seazn in General. `FEATURES.recordSend` (on, the owner's "On now (Recommended)", 2026-10-12). */
  readonly recordSend?: boolean;
};

/**
 * The app's Settings, opened from the gear in Home's corner (owner, 2026-11-02: "we should have common setting in a top
 * gear?" and, once drawn, "make sure that it is clean display instead of printing text"). It sits outside every mode,
 * so it has no LIVE plate and no Diagnostics, and Back returns Home. Rows, not paragraphs: each setting is one row with
 * its name at the left and its value or control at the right, in two grouped cards under short headings.
 *
 * General is what belongs to the phone and the app: Language, Battery (Android only), Share record and, with its switch
 * on, Send record to Seazn. Live Stream is the two phone settings of the viewfinder: the automatic switch and the side
 * of the controls. The Live Stream route's own Settings (with Diagnostics and the on-air rules) is unchanged.
 *
 * Portrait is one scrolling column. Landscape is two halves, each scrolling on its own: General at the left, Live Stream
 * and the licences at the right. The root says which in `data-layout`, the marker the tests read.
 */
export function AppSettingsScreen({ recordSend = FEATURES.recordSend }: AppSettingsScreenProps) {
  const { t } = useT();
  const { width, height } = useWindowDimensions();
  const layout = screenLayout(width, height);
  const toHome = useBackToHome();
  const header = (
    <SubScreenHeader
      title={t('settings.app.title')}
      onBack={toHome}
      plate={false}
      backLabel={t('stream.home')}
    />
  );
  const general = <GeneralSection recordSend={recordSend} />;
  const stream = <StreamSection />;
  if (layout === 'landscape') {
    return (
      <View {...layoutMarker('app-settings', layout)} style={styles.landscape}>
        {header}
        <View testID="app-settings-halves" style={styles.halves}>
          <ScrollView style={styles.half} contentContainerStyle={styles.sections}>
            {general}
          </ScrollView>
          <ScrollView style={styles.half} contentContainerStyle={styles.sections}>
            {stream}
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <View {...layoutMarker('app-settings', layout)} style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.column}>
        {header}
        <View style={styles.sections}>
          {general}
          {stream}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Language, Battery where Android knows the mode, Share record and Send record. The screen reads the battery mode
 * itself and draws the row only where it is known, so a phone without it has no empty row and no stray hairline.
 */
function GeneralSection({ recordSend }: { recordSend: boolean }) {
  const { t } = useT();
  const { mode, held, open } = usePowerState();
  return (
    <SettingsSection title={t('settings.section.general')}>
      <LanguageRow />
      {mode === null ? null : <BatteryRow mode={mode} held={held} open={open} />}
      <ShareRecordRow />
      {recordSend ? <SendRecordRow /> : null}
    </SettingsSection>
  );
}

/** The two phone settings, the licences after them, and the one line for a refused save. */
function StreamSection() {
  const { t } = useT();
  const { settings, change, saveFailed } = useStreamSettings();
  const toggleAutomatic = useCallback(
    () => change({ automatic: !settings.automatic }),
    [change, settings.automatic],
  );
  const sideLabel = t('settings.side.row');
  const sideWords = { left: t('settings.side.rowLeft'), right: t('settings.side.rowRight') };
  return (
    <>
      <SettingsSection title={t('settings.section.stream')}>
        <SettingsRow
          label={t('settings.automatic.row')}
          helper={t('settings.automatic.short')}
          checked={settings.automatic}
          onPress={toggleAutomatic}
        />
        <SettingsRow
          label={sideLabel}
          right={
            <SidePair side={settings.side} change={change} label={sideLabel} words={sideWords} />
          }
        />
      </SettingsSection>
      {saveFailed ? <Text variant="status">{t('settings.saveFailed')}</Text> : null}
      <SettingsGroup>
        <LicencesRow />
      </SettingsGroup>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  /** Portrait: the header, then the sections, in one column. */
  column: { gap: space.md, padding: space.md },
  /** The sections' own rhythm, in the column or a half's scroller. */
  sections: { gap: space.md },
  /** Landscape: the smaller vertical pad of the in-mode Settings, the header over two halves. */
  landscape: {
    flex: 1,
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: metrics.settingsPadV,
    backgroundColor: colour.ground,
  },
  halves: { flex: 1, flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
});
