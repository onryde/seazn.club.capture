import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Chip, Preflight } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Glyph, type GlyphName } from '@/ui/components/Glyph';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

const NAME: Readonly<Record<Chip, MessageKey>> = {
  camera: 'stream.chip.camera',
  sound: 'stream.chip.sound',
  network: 'stream.chip.network',
};

/** Spec §3: each chip draws one icon; the sound chip's is the mic. */
const GLYPH: Readonly<Record<Chip, GlyphName>> = {
  camera: 'camera',
  sound: 'mic',
  network: 'network',
};

/**
 * Spec §1's pre-flight, in its order (CHIP_ORDER): camera, sound and network,
 * from native's verdict, drawn as icons (spec §3), then AUTO when automatic
 * mode is on at both ends (A4), and "Starts {time}" under them (amendment §2,
 * D14). Written out rather than mapped over CHIP_ORDER, so a render allocates
 * no function (AGENTS §8).
 */
export const PreflightChips = memo(function PreflightChips({
  preflight,
  auto,
  startsAt,
}: {
  preflight: Preflight;
  auto: boolean;
  startsAt: string | null;
}) {
  const { t } = useT();
  return (
    <View style={styles.block}>
      <View testID="chip-row" style={styles.row}>
        <ChipView chip="camera" ok={preflight.camera} />
        <ChipView chip="sound" ok={preflight.sound} />
        <ChipView chip="network" ok={preflight.network} />
        {auto ? <AutoChip /> : null}
      </View>
      {startsAt === null ? null : (
        <Text variant="metricUnit">{t('stream.startsAt', { time: startsAt })}</Text>
      )}
    </View>
  );
});

/**
 * A4: a lime outline, as a ready chip, because it is a setting that is on,
 * not a check. A word with no ready or not-ready label: a screen reader reads
 * "Auto".
 */
const AutoChip = memo(function AutoChip() {
  const { t } = useT();
  return (
    <View style={autoChip}>
      <Text variant="control">{t('stream.chip.auto')}</Text>
    </View>
  );
});

/**
 * An icon in a 44 dp box. The name keeps its state for a screen reader
 * ("Camera: ready"); the state a sighted operator reads is the colour of the
 * outline and the icon, and the camera's slash (spec §3).
 */
const ChipView = memo(function ChipView({ chip, ok }: { chip: Chip; ok: boolean }) {
  const { t } = useT();
  const name = t(NAME[chip]);
  return (
    <View
      accessible
      accessibilityLabel={t(ok ? 'stream.chip.ok' : 'stream.chip.notOk', { chip: name })}
      style={ok ? chipOk : chipOff}
    >
      <Glyph name={GLYPH[chip]} slashed={chip === 'camera' && !ok} tone={ok ? 'lime' : 'caution'} />
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  /** The box of every chip: 44 dp tall, outlined, its contents centred. */
  chip: {
    height: layout.chip,
    borderWidth: layout.chipBorder,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** An icon chip is square. */
  icon: { width: layout.chip },
  /** AUTO is a word, so it is as wide as its word needs. */
  word: { paddingHorizontal: space.sm },
  ok: { borderColor: colour.lime },
  off: { borderColor: colour.caution },
});

const chipOk = [styles.chip, styles.icon, styles.ok];
const chipOff = [styles.chip, styles.icon, styles.off];
const autoChip = [styles.chip, styles.word, styles.ok];
