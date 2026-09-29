import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Mode } from '@/domain/mode/Mode';
import { useT } from '@/hooks/useLanguage';
import { MODE_NAME } from '@/i18n/modeNames';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/** Shown only when a mode that was left still holds a valid code (decision 2). */
export const ContinueCard = memo(function ContinueCard(props: {
  mode: Mode;
  slot: number | null;
  validTill: string;
  onContinue: () => void;
  onForget: () => void;
}) {
  const { t } = useT();
  const mode = t(MODE_NAME[props.mode]);
  return (
    <View style={styles.card}>
      <Text variant="state" style={styles.title}>
        {t('home.continue.title', { mode })}
      </Text>
      <Text variant="control">
        {t('home.continue.detail', { slot: props.slot ?? '–', time: props.validTill })}
      </Text>
      <View style={styles.actions}>
        <Button label={t('home.continue.open')} onPress={props.onContinue} />
        <GhostButton label={t('home.continue.forget')} onPress={props.onForget} />
      </View>
    </View>
  );
});

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
