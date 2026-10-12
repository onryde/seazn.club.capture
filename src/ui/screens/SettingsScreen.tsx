import { memo, useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { screenLayout } from '@/domain/mode/homeLayout';
import { useT } from '@/hooks/useLanguage';
import { useBackToHome, useBackToViewfinder } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import type { ControlSide, StreamSettings } from '@/services/streamSettingsStore';
import { ChoiceRow } from '@/ui/components/ChoiceRow';
import { DiagnosticsCard } from '@/ui/components/DiagnosticsCard';
import { PowerRow } from '@/ui/components/PowerRow';
import { RecordRow } from '@/ui/components/RecordRow';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { TextLink } from '@/ui/components/TextLink';
import { FEATURES } from '@/ui/features';
import { layoutMarker } from '@/ui/layoutMarker';
import { colour, layout as metrics, plateInk, radius, space } from '@/ui/theme/tokens';

/** D22: shipped and linked native code, and the one source link MPL-2.0 asks for. */
const LICENCES: readonly { readonly name: string; readonly licence: string }[] = [
  { name: 'libsrt', licence: 'MPL-2.0' },
  { name: 'StreamPack', licence: 'Apache-2.0' },
  { name: 'expo-video', licence: 'MIT' },
  { name: 'React Native', licence: 'MIT' },
  { name: 'Expo', licence: 'MIT' },
];
const LIBSRT_SOURCE = 'https://github.com/Haivision/srt';

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
 * R5: both variants carry the battery row after the power paragraph, on Android only. N33: both carry the record row
 * after it, Share record and, with its switch on, Send record to Seazn (R3).
 *
 * R2: opened from Home's Live Stream tile (`from="home"`) it is outside the mode: no Diagnostics card (nothing is
 * paired), no LIVE plate, and Back returns Home, named so. Landscape then draws one half, so the settings take the
 * width.
 * Both Back hooks run in both variants; each acts only on its own route, so neither takes the other's Back.
 */
type SettingsScreenProps = {
  /** R2: `home` is the screen opened from Home's Live Stream tile: no Diagnostics, no LIVE plate, Back to Home. */
  readonly from?: 'stream' | 'home';
  /** R3: Send record to Seazn in the record row. `FEATURES.recordSend` (on, the owner's ruling of 2026-10-12). */
  readonly recordSend?: boolean;
};

export function SettingsScreen({
  from = 'stream',
  recordSend = FEATURES.recordSend,
}: SettingsScreenProps) {
  const { t } = useT();
  const { width, height } = useWindowDimensions();
  const layout = screenLayout(width, height);
  const toCamera = useBackToViewfinder();
  const toHome = useBackToHome();
  const fromHome = from === 'home';
  const { settings, change, saveFailed } = useStreamSettings();
  const toggleAutomatic = useCallback(
    () => change({ automatic: !settings.automatic }),
    [change, settings.automatic],
  );
  const header = (
    <SubScreenHeader
      title={t('settings.title')}
      onBack={fromHome ? toHome : toCamera}
      plate={!fromHome}
      backLabel={fromHome ? t('stream.home') : undefined}
    />
  );
  const card = fromHome ? null : <DiagnosticsCard />;
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
          {card === null ? null : <ScrollView style={styles.half}>{card}</ScrollView>}
        </View>
      </View>
    );
  }
  return (
    <View {...layoutMarker('settings', layout)} style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.column}>
        {header}
        <View style={styles.controls}>{controls}</View>
        {card}
      </ScrollView>
    </View>
  );
}

/**
 * Controls on the left or the right (the owner's board): the label and, on the same line at its right, one outlined
 * pair of segments, the chosen one filled lime. A radiogroup named by the label, each segment a radio. Takes the
 * screen's own `change`, so a refused save says so in the one place the screen shows it.
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
  const label = t('settings.side.label');
  return (
    <View style={styles.side}>
      <Text variant="controlInk" style={styles.sideLabel}>
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.pair}>
        <Segment label={t('settings.side.left')} checked={side === 'left'} onPress={toLeft} />
        <Segment label={t('settings.side.right')} checked={side === 'right'} onPress={toRight} />
      </View>
    </View>
  );
}

/** One segment of the pair: a radio, 48 dp tall; chosen, a lime fill with night ink (the plate rule, AGENTS §5). */
const Segment = memo(function Segment({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      // aria-checked, not accessibilityState, as ChoiceRow has it.
      aria-checked={checked}
      onPress={onPress}
      style={checked ? segmentOn : styles.segment}
    >
      <Text variant="control" style={checked ? styles.segmentTextOn : undefined}>
        {label}
      </Text>
    </Pressable>
  );
});

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
  /** The label and the pair on one line, the pair at the right. */
  side: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sideLabel: { flex: 1 },
  /** One outlined box; clipping the segments inside it gives the lime fill the box's corners. */
  pair: {
    flexDirection: 'row',
    borderWidth: metrics.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  segment: {
    minHeight: metrics.touch,
    minWidth: metrics.segmentMin,
    paddingHorizontal: metrics.segmentPadX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: colour.lime },
  segmentTextOn: { color: plateInk },
  licences: { gap: space.xs },
});

const segmentOn = [styles.segment, styles.segmentOn];
