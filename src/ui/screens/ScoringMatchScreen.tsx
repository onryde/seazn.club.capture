import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useScoringMatch } from '@/hooks/useScoringMatch';
import { colour } from '@/ui/theme/tokens';

/**
 * The Remote Scoring match, for the match saved by a scan (plan S2-1 Task 10). The match is opened and focused here, so
 * its sender, its Realtime listener and its dead-link rule run while the route shows (`useScoringMatch`); what it draws
 * is Task 11's pad, which replaces this body and keeps the prop: a ground and nothing on it.
 */
export const ScoringMatchScreen = memo(function ScoringMatchScreen({
  fixtureId,
}: {
  fixtureId: string;
}) {
  useScoringMatch(fixtureId);
  return <View testID="scoring-match" style={styles.screen} />;
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
});
