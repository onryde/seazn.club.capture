import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { tallyTone, type TallyPlate as Plate, type TallyTone } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, plate as plateColour, plateInk, space } from '@/ui/theme/tokens';

const WORD: Readonly<Record<Plate, MessageKey>> = {
  starting: 'stream.tally.starting',
  notReady: 'stream.tally.notReady',
  ready: 'stream.tally.ready',
  connecting: 'stream.tally.connecting',
  live: 'stream.tally.live',
  trouble: 'stream.tally.trouble',
  ended: 'stream.tally.ended',
};

/**
 * The state plate (spec §4): 56 dp of solid colour, judged by what reads at
 * two metres, not by its type. The colour comes only from `tallyTone`, so red
 * can only ever mean LIVE.
 */
export const TallyPlate = memo(function TallyPlate({ plate }: { plate: Plate }) {
  const { t } = useT();
  const tone = tallyTone(plate);
  return (
    <View style={PLATE[tone]} testID="tally-plate" accessibilityLiveRegion="polite">
      <Text variant="state" style={INK[tone]}>
        {t(WORD[plate])}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  plate: { minHeight: 56, justifyContent: 'center', paddingHorizontal: space.sm },
  live: { backgroundColor: plateColour.live },
  healthy: { backgroundColor: plateColour.healthy },
  degraded: { backgroundColor: plateColour.degraded },
  inert: { backgroundColor: plateColour.inert },
  // The state role sets no colour, and Fabric's default text is black: every
  // plate names its ink (the ContinueCard lesson, AGENTS §13).
  onPlate: { color: plateInk },
  onInert: { color: colour.ink },
});

const PLATE: Readonly<Record<TallyTone, StyleProp<ViewStyle>>> = {
  live: [styles.plate, styles.live],
  healthy: [styles.plate, styles.healthy],
  degraded: [styles.plate, styles.degraded],
  inert: [styles.plate, styles.inert],
};
const INK: Readonly<Record<TallyTone, StyleProp<TextStyle>>> = {
  live: styles.onPlate,
  healthy: styles.onPlate,
  degraded: styles.onPlate,
  inert: styles.onInert,
};
