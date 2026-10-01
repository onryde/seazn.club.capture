import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { LivePlate } from '@/ui/components/LivePlate';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** The way back, with the LIVE plate beside it so the broadcast is never out of sight (AGENTS §6). */
export const SubScreenHeader = memo(function SubScreenHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <View style={styles.header}>
      <GhostButton label={t('stream.back')} onPress={onBack} />
      <LivePlate />
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
});
