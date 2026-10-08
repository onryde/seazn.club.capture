import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ContinueCopy } from '@/domain/mode/continueCard';
import type { Mode } from '@/domain/mode/Mode';
import { useT } from '@/hooks/useLanguage';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { rowCardPadding, type CardShape } from '@/ui/components/cardShape';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * Shown only when a mode that was left still holds a valid code (decision 2).
 * What it says is `continueCard`'s (amendment §2, Home). `row` is the landscape card (spec §7, F15): the title and
 * the detail on the left, the two buttons at the end, in one row.
 */
export const ContinueCard = memo(function ContinueCard(props: {
  mode: Mode;
  copy: ContinueCopy;
  layout?: CardShape;
  onContinue: () => void;
  onForget: () => void;
}) {
  const { t } = useT();
  const { title, detail } = cardText(props.mode, props.copy, t);
  const heading = (
    <Text variant="state" style={styles.title}>
      {title}
    </Text>
  );
  const line = <Text variant="control">{detail}</Text>;
  const actions = (
    <View style={styles.actions}>
      <Button label={t('home.continue.open')} onPress={props.onContinue} />
      <GhostButton label={t('home.continue.forget')} onPress={props.onForget} />
    </View>
  );
  if (props.layout === 'row') {
    return (
      <View testID="continue-card" style={rowStyles.card}>
        <View style={rowStyles.text}>
          {heading}
          {line}
        </View>
        {actions}
      </View>
    );
  }
  return (
    <View testID="continue-card" style={styles.card}>
      {heading}
      {line}
      {actions}
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

const rowStyles = StyleSheet.create({
  card: {
    ...rowCardPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colour.lime,
    backgroundColor: colour.surface,
  },
  // The words take what the buttons leave and wrap inside it, never behind them.
  text: { flex: 1, minWidth: 0, gap: space.xs },
});
