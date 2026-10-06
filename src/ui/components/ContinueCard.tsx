import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ContinueCopy } from '@/domain/mode/continueCard';
import type { Mode } from '@/domain/mode/Mode';
import { useT } from '@/hooks/useLanguage';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * Shown only when a mode that was left still holds a valid code (decision 2).
 * What it says is `continueCard`'s (amendment §2, Home).
 */
export const ContinueCard = memo(function ContinueCard(props: {
  mode: Mode;
  copy: ContinueCopy;
  onContinue: () => void;
  onForget: () => void;
}) {
  const { t } = useT();
  const { title, detail } = cardText(props.mode, props.copy, t);
  return (
    <View style={styles.card}>
      <Text variant="state" style={styles.title}>
        {title}
      </Text>
      <Text variant="control">{detail}</Text>
      <View style={styles.actions}>
        <Button label={t('home.continue.open')} onPress={props.onContinue} />
        <GhostButton label={t('home.continue.forget')} onPress={props.onForget} />
      </View>
    </View>
  );
});

/** CD39: a code with no `exp` says its slot alone, never "code valid till ." */
function cardText(
  mode: Mode,
  copy: ContinueCopy,
  t: Translator['t'],
): { title: string; detail: string } {
  const title = t('home.continue.title', { mode: t(MODE_NAME[mode]) });
  // Review C5 I-4: in the stream screen's own words for Pairing.
  if (copy.kind === 'pairing') return { title, detail: t('stream.status.pairing') };
  if (copy.kind === 'paired') {
    return {
      title: t('home.continue.paired', { label: copy.label }),
      detail: t('home.continue.waiting'),
    };
  }
  const slot = copy.slot ?? '–';
  return {
    title,
    detail:
      copy.validTill === null
        ? t('home.continue.slot', { slot })
        : t('home.continue.detail', { slot, time: copy.validTill }),
  };
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colour.lime,
    backgroundColor: colour.surface,
  },
  // The `state` role sets no colour, and the platform default is black, which
  // is invisible on `surface`.
  title: { color: colour.ink },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
