import { memo, useCallback, useMemo, type ComponentProps, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CricketSetupView } from '@/domain/scoring/cricketSetup';
import type { CricketPadActions } from '@/hooks/useCricketMatch';
import type { CricketSetupModel } from '@/hooks/useCricketSetup';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { DetailsCard } from '@/ui/components/DetailsCard';
import { GhostButton } from '@/ui/components/GhostButton';
import { StepRow, type StepOption } from '@/ui/components/StepSheet';
import { Text } from '@/ui/components/Text';
import { CricketOrderList } from '@/ui/screens/CricketOrderList';
import { CricketToss } from '@/ui/screens/CricketToss';
import { colour, space } from '@/ui/theme/tokens';

type Details = ComponentProps<typeof DetailsCard>['details'];

/**
 * Cricket's setup before its first ball, in the board's place (S2-4 spec §4.1, owner ruling 83; plan Task 10), one step at
 * a time as the hook gives it (`useCricketSetup`):
 * - the toss, on the whole screen (`CricketToss`);
 * - the match card, then the batting side's order with ▲▼ (`CricketOrderList`), then Next, which picks its first two;
 * - the openers picked, the fielding side's players to bowl the first over (each row with the lime border, the one picked
 *   the heavier), then Back to the order and Start match, which waits for a bowler.
 *
 * A side with no players entered asks nothing after the toss: the match card and Start match (spec §4.10). The buttons
 * stand under the scroll, so they are where the thumb is whatever the list's length. Undo, under it all, takes the toss
 * back (the pad's last-tap line).
 */
export const CricketSetup = memo(function CricketSetup({
  setup,
  details,
  actions,
}: {
  readonly setup: CricketSetupModel;
  readonly details: Details;
  readonly actions: CricketPadActions;
}) {
  const { step, view } = setup;
  switch (step) {
    case 'toss':
      return (
        <CricketToss
          teams={view.teams}
          winner={setup.tossWinner}
          onWinner={actions.pickTossWinner}
          onElect={actions.recordToss}
        />
      );
    case 'order':
      return <OrderStep view={view} details={details} actions={actions} />;
    default:
      return <BowlerStep setup={setup} details={details} actions={actions} />;
  }
});

function SetupFrame({
  foot,
  children,
}: {
  readonly foot: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <View testID="cricket-setup" style={styles.frame}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
      <View style={styles.foot}>{foot}</View>
    </View>
  );
}

const OrderStep = memo(function OrderStep({
  view,
  details,
  actions,
}: {
  readonly view: CricketSetupView;
  readonly details: Details;
  readonly actions: CricketPadActions;
}) {
  const { t } = useT();
  const { nextOpeners } = view;
  const { setOpeners } = actions;
  const next = useCallback(() => {
    if (nextOpeners !== null) setOpeners(nextOpeners);
  }, [nextOpeners, setOpeners]);
  const foot = (
    <Button
      label={t('scoring.cricket.setup.next')}
      onPress={next}
      disabled={nextOpeners === null}
    />
  );
  return (
    <SetupFrame foot={foot}>
      <DetailsCard details={details} />
      <Text variant="panelTitle" accessibilityRole="header" style={styles.ink}>
        {t('scoring.cricket.setup.order', { team: view.batting?.label ?? '' })}
      </Text>
      <Text variant="body" style={styles.ink2}>
        {t('scoring.cricket.setup.orderHint')}
      </Text>
      <CricketOrderList order={view.order} onMove={actions.moveBatter} />
    </SetupFrame>
  );
});

const BowlerStep = memo(function BowlerStep({
  setup,
  details,
  actions,
}: {
  readonly setup: CricketSetupModel;
  readonly details: Details;
  readonly actions: CricketPadActions;
}) {
  const { t } = useT();
  const { view } = setup;
  const foot = (
    <View style={styles.pair}>
      {view.openers === null ? null : (
        <GhostButton label={t('scoring.cricket.setup.back')} onPress={actions.changeOrder} />
      )}
      <View style={styles.grow}>
        <Button
          label={t('scoring.start.confirm')}
          onPress={actions.start}
          disabled={!setup.ready}
        />
      </View>
    </View>
  );
  return (
    <SetupFrame foot={foot}>
      {view.openers === null ? <DetailsCard details={details} /> : <Openers view={view} />}
      <BowlerList view={view} onPick={actions.setBowler} />
    </SetupFrame>
  );
});

function Openers({ view }: { readonly view: CricketSetupView }) {
  const { t } = useT();
  const { openers } = view;
  if (openers === null) return null;
  return (
    <Text variant="body" style={styles.ink2}>
      {t('scoring.cricket.setup.openers', {
        striker: openers.striker.name,
        nonStriker: openers.nonStriker.name,
      })}
    </Text>
  );
}

/** The fielding side's players, a row each (the step sheet's `StepRow`): the one picked has the heavier lime border. */
function BowlerList({
  view,
  onPick,
}: {
  readonly view: CricketSetupView;
  readonly onPick: (id: string) => void;
}) {
  const { t } = useT();
  const options = useMemo<readonly StepOption[]>(
    () =>
      view.bowlers.map((one) => ({
        id: one.id,
        label: one.name,
        tone: 'standard',
        chosen: one.chosen,
      })),
    [view.bowlers],
  );
  if (options.length === 0 || view.fielding === null) return null;
  return (
    <View testID="first-bowler" style={styles.list}>
      <Text variant="panelTitle" accessibilityRole="header" style={styles.ink}>
        {t('scoring.cricket.setup.bowler', { team: view.fielding.label })}
      </Text>
      {options.map((option) => (
        <StepRow key={option.id} option={option} onChoose={onPick} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, gap: space.sm },
  scroll: { flex: 1 },
  content: { gap: space.md },
  foot: { gap: space.sm },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grow: { flexGrow: 1 },
  list: { gap: space.sm },
  ink: { color: colour.ink },
  ink2: { color: colour.ink2 },
});
