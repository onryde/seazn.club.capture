import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { IconButton } from '@/ui/components/IconButton';
import { LivePlate } from '@/ui/components/LivePlate';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * The way back, with the LIVE plate beside it so the broadcast is never out of sight (AGENTS §6). Back is the
 * owner's board's square outlined chevron (an icon button), named by the same words as before. Outside a mode
 * (Stream Settings from Home, R2) `plate` is false, as there are no on-air rules there, and `backLabel` names where
 * Back goes instead of the camera.
 */
export const SubScreenHeader = memo(function SubScreenHeader({
  title,
  onBack,
  plate = true,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  plate?: boolean;
  backLabel?: string;
}) {
  const { t } = useT();
  return (
    <View style={styles.header}>
      <IconButton glyph="back" label={backLabel ?? t('stream.back')} onPress={onBack} />
      {plate ? <LivePlate /> : null}
      <Text variant="action" style={styles.title}>
        {title}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
});
