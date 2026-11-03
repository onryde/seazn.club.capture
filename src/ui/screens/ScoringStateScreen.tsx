import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ScoringState } from '@/hooks/padScreenModel';
import { useT } from '@/hooks/useLanguage';
import { useScoringStateActions, type StateActions } from '@/hooks/useScoringStateActions';
import { useBackToHome } from '@/hooks/useStreamLinks';
import { DismissSheet } from '@/ui/components/DismissSheet';
import { IconButton } from '@/ui/components/IconButton';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { ScoringStateCard } from '@/ui/components/ScoringStateCard';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * A scoring match that is not a pad, whatever its sport (plan S2-1 Task 11): the pad's own top bar, reduced to Back,
 * and the state's card where the halves would be, scrolling when it is taller than the room. Back, and the phone's
 * Back, go Home (owner ruling 10: Back goes Home freely). Its exits are the card's buttons (`useScoringStateActions`);
 * a Dismiss that would throw taps away asks first, in a sheet that hides the card from a screen reader while it shows.
 * The screen is held on only while the scorer is waiting to score (loading, offline: owner ruling 9, applied 2026-11-02);
 * a state that needs a person to act lets it sleep.
 */
export const ScoringStateScreen = memo(function ScoringStateScreen({
  fixtureId,
  state,
}: {
  readonly fixtureId: string;
  readonly state: ScoringState;
}) {
  const actions = useScoringStateActions(fixtureId);
  return (
    <View testID="scoring-match" style={styles.screen}>
      {state.kind === 'loading' ? <KeepScreenOn /> : null}
      <View
        testID="scoring-state-content"
        aria-hidden={actions.asking !== null}
        importantForAccessibility={actions.asking === null ? 'auto' : 'no-hide-descendants'}
        style={styles.content}
      >
        <StateHeader />
        <StateBody state={state} actions={actions} />
      </View>
      <Question actions={actions} />
    </View>
  );
});

const StateHeader = memo(function StateHeader() {
  const { t } = useT();
  const home = useBackToHome();
  return (
    <View style={styles.header}>
      <IconButton glyph="back" label={t('stream.home')} onPress={home} />
    </View>
  );
});

const StateBody = memo(function StateBody({
  state,
  actions,
}: {
  readonly state: ScoringState;
  readonly actions: StateActions;
}) {
  const { t } = useT();
  return (
    <ScrollView testID="scoring-state-scroll" style={styles.body}>
      <ScoringStateCard
        state={state}
        note={actions.note === null ? null : t(actions.note)}
        onUpdate={actions.update}
        onBrowser={actions.browser}
        onDismiss={actions.dismiss}
      />
    </ScrollView>
  );
});

/** The question before a Dismiss that discards taps (owner ruling B): the match and the count, in the home sheet's words. */
const Question = memo(function Question({ actions }: { readonly actions: StateActions }) {
  const { t, tp } = useT();
  const { asking } = actions;
  if (asking === null) return null;
  const match = asking.label === '' ? t('home.scoring.matchFallback') : asking.label;
  return (
    <DismissSheet
      title={t('home.scoring.confirm.title', { match })}
      body={
        asking.unsent === null
          ? t('home.scoring.confirm.bodyUnreadable')
          : tp('home.scoring.confirm.body', asking.unsent)
      }
      keepLabel={t('home.scoring.confirm.keep')}
      dismissLabel={t('home.scoring.dismiss')}
      onKeep={actions.keep}
      onDismiss={actions.confirm}
    />
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  content: { flex: 1, gap: space.sm, padding: space.md },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: layout.touch },
  body: { flex: 1 },
});
