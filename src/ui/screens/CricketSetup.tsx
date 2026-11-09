import { memo, useCallback, useMemo, type ComponentProps, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CricketBreakCard } from '@/domain/scoring/cricketPad';
import type { CricketSetupView } from '@/domain/scoring/cricketSetup';
import type { CricketPadActions } from '@/hooks/useCricketMatch';
import type { CricketSetupModel } from '@/hooks/useCricketSetup';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
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
 *
 * At an innings break, and before a super over (spec §4.5, §4.6; plan Task 16), the same steps stand under the break's
 * card in the match card's place (`BreakCard`: the innings closed, then the target or the lead): the side batting next's
 * order and openers, its bowler, then Start innings. More stands in the foot while it offers something (the follow-on,
 * closing the match); a super over offers nothing. Undo takes back the innings' last ball.
 */
export const CricketSetup = memo(function CricketSetup({
  setup,
  details,
  more,
  actions,
}: {
  readonly setup: CricketSetupModel;
  readonly details: Details;
  /** More offers something now: at a break, its button stands in the foot. */
  readonly more: boolean;
  readonly actions: CricketPadActions;
}) {
  const { step, view } = setup;
  const top =
    setup.card === null ? <DetailsCard details={details} /> : <BreakCard card={setup.card} />;
  const breakMore = setup.card !== null && more ? actions.openMore : null;
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
    case 'openers':
      return <OrderStep view={view} top={top} onMore={breakMore} actions={actions} />;
    default:
      return <BowlerStep setup={setup} top={top} onMore={breakMore} actions={actions} />;
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

/** The break's More, a ghost button beside the foot's own, while it offers something; nothing else. */
function MoreButton({ onMore }: { readonly onMore: (() => void) | null }) {
  const { t } = useT();
  if (onMore === null) return null;
  return <GhostButton label={t('scoring.cricket.key.more')} onPress={onMore} />;
}

/** The innings break's card: its title, then the innings closed and what the next one needs, or the lead. */
const BreakCard = memo(function BreakCard({ card }: { readonly card: CricketBreakCard }) {
  const words = usePadText();
  return (
    <View testID="break-card" style={styles.card}>
      <Text variant="panelTitle" accessibilityRole="header" style={styles.ink}>
        {words(card.title)}
      </Text>
      {card.line === null ? null : (
        <Text testID="break-line" variant="body" style={styles.ink}>
          {words(card.line)}
        </Text>
      )}
    </View>
  );
});

const OrderStep = memo(function OrderStep({
  view,
  top,
  onMore,
  actions,
}: {
  readonly view: CricketSetupView;
  /** The match card, or at a break the break's card. */
  readonly top: ReactNode;
  readonly onMore: (() => void) | null;
  readonly actions: CricketPadActions;
}) {
  const { t } = useT();
  const { nextOpeners } = view;
  const { setOpeners } = actions;
  const next = useCallback(() => {
    if (nextOpeners !== null) setOpeners(nextOpeners);
  }, [nextOpeners, setOpeners]);
  const foot = (
    <View style={styles.pair}>
      <MoreButton onMore={onMore} />
      <View style={styles.grow}>
        <Button
          label={t('scoring.cricket.setup.next')}
          onPress={next}
          disabled={nextOpeners === null}
        />
      </View>
    </View>
  );
  return (
    <SetupFrame foot={foot}>
      {top}
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
  top,
  onMore,
  actions,
}: {
  readonly setup: CricketSetupModel;
  readonly top: ReactNode;
  readonly onMore: (() => void) | null;
  readonly actions: CricketPadActions;
}) {
  const { t } = useT();
  const { view } = setup;
  const innings = setup.begins === 'innings';
  const back =
    view.openers === null ? null : (
      <GhostButton label={t('scoring.cricket.setup.back')} onPress={actions.changeOrder} />
    );
  const start = (
    <Button
      label={t(innings ? 'scoring.cricket.setup.startInnings' : 'scoring.start.confirm')}
      onPress={innings ? actions.startInnings : actions.start}
      disabled={!setup.ready}
    />
  );
  const foot = (
    <BowlerFoot
      back={back}
      more={<MoreButton onMore={onMore} />}
      stacked={back !== null && onMore !== null}
    >
      {start}
    </BowlerFoot>
  );
  // Before the match the match card gives way to the openers once they are picked; a break's card stays above them.
  return (
    <SetupFrame foot={foot}>
      {view.openers === null || setup.card !== null ? top : null}
      <Openers view={view} />
      <BowlerList view={view} onPick={actions.setBowler} />
    </SetupFrame>
  );
});

/**
 * Back, More and the start button. With both ghost buttons the start button has its own row below them: three in one
 * wrapping row broke at 320 dp (the start button is 200 dp at least), and a break should not depend on the phone's width.
 * With one, it sits beside the start button as the order step's does.
 */
function BowlerFoot({
  back,
  more,
  stacked,
  children,
}: {
  readonly back: ReactNode;
  readonly more: ReactNode;
  readonly stacked: boolean;
  readonly children: ReactNode;
}) {
  if (!stacked) {
    return (
      <View style={styles.pair}>
        {back}
        {more}
        <View style={styles.grow}>{children}</View>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <View style={styles.ghosts}>
        <View style={styles.half}>{back}</View>
        <View style={styles.half}>{more}</View>
      </View>
      {children}
    </View>
  );
}

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
  card: { gap: space.xs },
  scroll: { flex: 1 },
  content: { gap: space.md },
  foot: { gap: space.sm },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stack: { gap: space.sm },
  ghosts: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1 },
  list: { gap: space.sm },
  ink: { color: colour.ink },
  ink2: { color: colour.ink2 },
});
