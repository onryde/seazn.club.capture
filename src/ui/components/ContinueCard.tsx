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
 * What it says is `continueCard`'s (amendment §2, Home). `row` is the landscape card (spec §7, F15): the title and the
 * detail on the left, the buttons at the end, in one row. Match Day has no card (S4 design §4; owner, 2026-11-12).
 */
export const ContinueCard = memo(function ContinueCard(props: {
  mode: Mode;
  copy: ContinueCopy;
  layout?: CardShape;
  onContinue: () => void;
  onForget?: () => void;
  /**
   * The operator's start is in flight: native ignores an unpair then, so Forget is off until it answers, and the
   * card says what is happening (court stream Task 13 fix round 2 m4).
   */
  starting?: boolean;
}) {
  const { t } = useT();
  const starting = props.starting === true;
  const { title, detail } = cardText(props.mode, props.copy, t, starting);
  const forget = holdsCourt(props.copy) ? undefined : props.onForget;
  const heading = (
    <Text variant="state" style={styles.title}>
      {title}
    </Text>
  );
  const line = detail === null ? null : <Text variant="control">{detail}</Text>;
  const actions = (
    <View style={styles.actions}>
      <Button label={t('home.continue.open')} onPress={props.onContinue} />
      {forget === undefined ? null : (
        <GhostButton label={t('home.continue.forget')} onPress={forget} disabled={starting} />
      )}
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

/**
 * A phone that holds a court (court stream spec 2026-11-14 §6.5, RP4; O5, O12): paired or pairing to a court code. Its
 * card has no Forget, because the only way off a court is Exit on the waiting screen, which asks first. A saved court
 * code the engine does not hold has nothing to leave, so it keeps Forget, as a code that is stuck must be clearable.
 */
const holdsCourt = (copy: ContinueCopy) => copy.kind !== 'saved' && copy.court !== null;

/** CD39: a code with no `exp` says its slot alone, never "code valid till ." */
function cardText(
  mode: Mode,
  copy: ContinueCopy,
  t: Translator['t'],
  starting: boolean,
): { title: string; detail: string | null } {
  // A court code is named by its court (§6.5); every other card keeps its own title.
  const named = (title: string) =>
    copy.court === null
      ? title
      : t('home.continue.court', { court: copy.court, mode: t(MODE_NAME[mode]) });
  const title = t('home.continue.title', { mode: t(MODE_NAME[mode]) });
  // Review C5 I-4: in the stream screen's own words for Pairing.
  if (copy.kind === 'pairing') return { title: named(title), detail: t('stream.status.pairing') };
  if (copy.kind === 'paired') {
    return {
      title: named(t('home.continue.paired', { label: copy.label })),
      // Not waiting while the operator's start is in flight: the stream screen's own line for it (fix round 2 m4).
      detail: t(starting ? 'stream.status.connecting' : 'home.continue.waiting'),
    };
  }
  const slot = copy.slot ?? '–';
  return {
    title: named(title),
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
