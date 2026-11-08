import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { useBackToHome } from '@/hooks/useStreamLinks';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Match Day's route (MD-2 Task 3, the dispatch's ruling 5): until Task 4 draws the day's list, it says the day is being
 * opened, in the operator's words, so the tile never moves to a route with nothing on it. Back returns Home, as from
 * Remote Scoring.
 */
export function MatchDayScreen() {
  const { t } = useT();
  useBackToHome();
  return (
    <View testID="matchday-screen" style={styles.screen}>
      <Text variant="title">{t('matchday.loading.title')}</Text>
      <Text variant="body">{t('matchday.loading.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: space.sm,
    padding: space.md,
    backgroundColor: colour.ground,
  },
});
