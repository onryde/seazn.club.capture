import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Chip, Preflight } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

const NAME: Readonly<Record<Chip, MessageKey>> = {
  camera: 'stream.chip.camera',
  sound: 'stream.chip.sound',
  network: 'stream.chip.network',
};

/**
 * Spec §1's pre-flight, in its order (CHIP_ORDER): camera, sound and network,
 * from native's verdict, then AUTO when automatic mode is on at both ends (A4),
 * and "Starts {time}" under them (amendment §2). Written out rather than
 * mapped over CHIP_ORDER, so a render allocates no function (AGENTS §8).
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
    <View style={chipOk}>
      <Text variant="control">{t('stream.chip.auto')}</Text>
    </View>
  );
});

const ChipView = memo(function ChipView({ chip, ok }: { chip: Chip; ok: boolean }) {
  const { t } = useT();
  const name = t(NAME[chip]);
  return (
    <View
      accessible
      accessibilityLabel={t(ok ? 'stream.chip.ok' : 'stream.chip.notOk', { chip: name })}
      style={ok ? chipOk : chipOff}
    >
      <Text variant="control">{name}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { paddingHorizontal: space.xs, borderWidth: 2 },
  ok: { borderColor: colour.lime },
  off: { borderColor: colour.caution },
});

const chipOk = [styles.chip, styles.ok];
const chipOff = [styles.chip, styles.off];
