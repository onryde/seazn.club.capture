import { memo } from 'react';
import { View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';

type EndingPromptProps = {
  /** The disqualified person, as typed. */
  readonly person: string;
  readonly onRecord: () => void;
  readonly onVoid: () => void;
};

/**
 * After a disqualification is recorded (owner rulings, 2026-10-31): record the ending, which ends the match, or void
 * the sanction, if it was a mistake. Nothing else closes it: the dim takes no tap, and the caller holds Back, because a
 * match left between the two is in neither state. A plain View, as every pad sheet (`padSheet.ts`).
 */
export const EndingPrompt = memo(function EndingPrompt({
  person,
  onRecord,
  onVoid,
}: EndingPromptProps) {
  const { t } = useT();
  return (
    <View style={padSheet.overlay}>
      <View aria-hidden style={padSheet.dim} />
      <View testID="ending-prompt" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{t('scoring.ending.title', { person })}</Text>
        <Text variant="body">{t('scoring.ending.body')}</Text>
        <Button label={t('scoring.ending.record')} onPress={onRecord} />
        <GhostButton label={t('scoring.ending.void')} onPress={onVoid} />
      </View>
    </View>
  );
});
