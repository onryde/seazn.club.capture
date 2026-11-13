import { memo, useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import type { SendingCard as Sending } from '@/domain/matchday/exit';
import type { ScoringCurrent, ScoringLeftover } from '@/domain/mode/scoringHome';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { rowCardPadding, type CardShape } from '@/ui/components/cardShape';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, layout as sizes, radius, space } from '@/ui/theme/tokens';

/**
 * Home's Remote Scoring cards (plan S2-1 Task 10; design §5, §6.3, ruling 29). What each says is `scoringHome`'s
 * decision; the words are here, in the order the operator needs them: which match, what is unsent, what to do. A live
 * queue is only counted, because it is still sending; a queue that can never send, or cannot be read, is told to the
 * organiser, in orange (a failure reads orange, never red). Its Dismiss asks first (owner ruling B, 2026-11-02), and
 * each card's button carries its match in its name, so two cards never both read just "Dismiss". A match that is over
 * with every tap sent is a card of its own (owner ruling 41, 2026-11-02): Finished with the score, its words a press
 * target that opens the match, and Close, the one button, which lets it go.
 */

/** The edge: lime for the saved match, quiet for taps elsewhere that are still sending, orange for a failure. */
type Edge = 'saved' | 'quiet' | 'failing';

/** The card itself, stacked for portrait and one row for landscape. */
function CardFrame(props: {
  testID: string;
  layout: CardShape | undefined;
  edge: Edge;
  children: ReactNode;
}) {
  const row = props.layout === 'row';
  return (
    <View testID={props.testID} style={[row ? rowStyles.card : styles.card, EDGE[props.edge]]}>
      {props.children}
    </View>
  );
}

/** The words, on the left of a landscape card and above the buttons of a portrait one. */
function CardText(props: { layout: CardShape | undefined; children: ReactNode }) {
  return (
    <View style={props.layout === 'row' ? rowStyles.text : styles.text}>{props.children}</View>
  );
}

/**
 * The words as a press target (a finished match's card opens the match): the same column, at least a `touch` tall, and the
 * press fill while it is held, as the plates and ghosts have (never a dim alone). It reads to a screen reader as one
 * button named by its words.
 */
function PressableText(props: {
  layout: CardShape | undefined;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={props.layout === 'row' ? rowBody : stackedBody}
    >
      {props.children}
    </Pressable>
  );
}

/** Module-level so render allocates no function (the press state is Pressable's). */
function stackedBody({ pressed }: PressableStateCallbackType) {
  return pressed ? stackedPressed : stackedIdle;
}
function rowBody({ pressed }: PressableStateCallbackType) {
  return pressed ? rowPressed : rowIdle;
}

/** The buttons: they wrap under each other where the card is too narrow for both (`scoringHomeFit`). */
function CardActions(props: { children: ReactNode }) {
  return (
    <View testID="scoring-actions" style={styles.actions}>
      {props.children}
    </View>
  );
}

/** A screen reader's name for a card's Dismiss, Close or View result: its match, or "another match" for one that never learned its name. */
function nameFor(
  key: 'home.scoring.dismissMatch' | 'home.scoring.closeMatch' | 'home.scoring.viewMatch',
  label: string,
  translator: Translator,
): string {
  const match = label === '' ? translator.t('home.scoring.matchFallback') : label;
  return translator.t(key, { match });
}

/** A Dismiss button for one match: the short word drawn, the match in its name. */
function DismissButton(props: {
  fixtureId: string;
  label: string;
  onDismiss: (fixtureId: string) => void;
}) {
  const translator = useT();
  const { fixtureId, onDismiss } = props;
  const press = useCallback(() => onDismiss(fixtureId), [onDismiss, fixtureId]);
  return (
    <GhostButton
      label={translator.t('home.scoring.dismiss')}
      accessibilityLabel={nameFor('home.scoring.dismissMatch', props.label, translator)}
      onPress={press}
    />
  );
}

/**
 * The sentence under a match's name: what is unsent and what that means; null when there is nothing to say. A queue held
 * for the scorer's answer says the pad's own words (`scoring.sync.asked`): it is not sending, it is waiting for them.
 */
function currentSentence(current: ScoringCurrent, t: Translator): string | null {
  if (current.state === 'unreadable') return t.t('home.scoring.unreadable');
  if (current.unsent === 0) return null;
  if (current.state === 'asked') return t.tp('scoring.sync.asked', current.unsent);
  const key = current.state === 'dead' ? 'home.scoring.deadHere' : 'home.scoring.unsent';
  return t.tp(key, current.unsent);
}

type ContinueProps = {
  current: ScoringCurrent;
  layout?: CardShape;
  onContinue: () => void;
  /** Forget: nothing is unsent, so nothing is asked. */
  onForget: (fixtureId: string) => void;
  /** Dismiss: taps would be discarded, so Home asks first. */
  onDismiss: (fixtureId: string) => void;
  /** Close, on a finished match: lets it go with no question while nothing is unsent, and asks if a tap has appeared since. */
  onClose: (fixtureId: string) => void;
};

/** The saved match's words: the title, its name, and what is unsent. */
function CurrentText({ current, layout }: { current: ScoringCurrent; layout?: CardShape }) {
  const translator = useT();
  const sentence = currentSentence(current, translator);
  return (
    <CardText layout={layout}>
      <Text variant="state" style={styles.title}>
        {translator.t('home.continue.title', { mode: translator.t('mode.scoring') })}
      </Text>
      {current.label === '' ? null : (
        <Text variant="control" style={styles.line}>
          {current.label}
        </Text>
      )}
      {sentence === null ? null : (
        <Text variant="control" style={current.state === 'live' ? styles.line : styles.failing}>
          {sentence}
        </Text>
      )}
    </CardText>
  );
}

/**
 * Forget when nothing is unsent, Dismiss when the taps can never go, nothing while they are still sending: a Dismiss
 * on a live queue would discard taps that are about to be sent (ruling 29). Nor while they wait for the scorer's answer:
 * Continue opens the pad, which asks, and the question names what a discard would cost.
 */
function CurrentActions(props: Omit<ContinueProps, 'layout' | 'onClose'>) {
  const translator = useT();
  const { current, onForget } = props;
  const forget = useCallback(() => onForget(current.fixtureId), [onForget, current.fixtureId]);
  return (
    <CardActions>
      <Button label={translator.t('home.continue.open')} onPress={props.onContinue} />
      {current.state === 'dead' || current.state === 'unreadable' ? (
        <DismissButton
          fixtureId={current.fixtureId}
          label={current.label}
          onDismiss={props.onDismiss}
        />
      ) : null}
      {current.state === 'live' && current.unsent === 0 ? (
        <GhostButton label={translator.t('home.continue.forget')} onPress={forget} />
      ) : null}
    </CardActions>
  );
}

/** A finished match's words: what happened and the score in the scoreboard's lime, then its name. */
function FinishedText({ current }: { current: ScoringCurrent }) {
  const translator = useT();
  const score = current.finished?.score ?? '';
  return (
    <>
      <Text variant="state" style={styles.final}>
        {score === ''
          ? translator.t('home.scoring.finished')
          : translator.t('home.scoring.finishedScore', { score })}
      </Text>
      {current.label === '' ? null : (
        <Text variant="control" style={styles.line}>
          {current.label}
        </Text>
      )}
    </>
  );
}

/**
 * A match that is over, every tap sent (owner ruling 41, 2026-11-02): its words open the match, as they stand (the pad's
 * result card, or its view-only one once the organiser has finalized it); View result, a button before Close (owner,
 * 2026-11-12: the words did not look pressable, superseding "the one button"), does the same, and Close lets it go.
 * There is no Forget and no Continue: the match is not in play, and closing it loses nothing.
 */
function FinishedCard(props: ContinueProps) {
  const translator = useT();
  const { current, layout, onClose } = props;
  const close = useCallback(() => onClose(current.fixtureId), [onClose, current.fixtureId]);
  return (
    <CardFrame testID="scoring-continue" layout={layout} edge="saved">
      <PressableText layout={layout} onPress={props.onContinue}>
        <FinishedText current={current} />
      </PressableText>
      <CardActions>
        <GhostButton
          label={translator.t('home.scoring.view')}
          accessibilityLabel={nameFor('home.scoring.viewMatch', current.label, translator)}
          onPress={props.onContinue}
        />
        <GhostButton
          label={translator.t('home.scoring.close')}
          accessibilityLabel={nameFor('home.scoring.closeMatch', current.label, translator)}
          onPress={close}
        />
      </CardActions>
    </CardFrame>
  );
}

/** The saved match: Continue opens the pad; the second button lets the match go when it holds nothing that can send. */
export const ScoringContinueCard = memo(function ScoringContinueCard(props: ContinueProps) {
  const { current, layout } = props;
  if (current.finished !== null) return <FinishedCard {...props} />;
  return (
    <CardFrame
      testID="scoring-continue"
      layout={layout}
      edge={current.state === 'live' ? 'saved' : 'failing'}
    >
      <CurrentText current={current} layout={layout} />
      <CurrentActions
        current={current}
        onContinue={props.onContinue}
        onForget={props.onForget}
        onDismiss={props.onDismiss}
      />
    </CardFrame>
  );
});

type LeftoverProps = {
  leftover: ScoringLeftover;
  layout?: CardShape;
  onDismiss: (fixtureId: string) => void;
};

function leftoverLabel(leftover: ScoringLeftover): string {
  return leftover.kind === 'unreadable' ? '' : leftover.label;
}

function leftoverSentence(leftover: ScoringLeftover, translator: Translator): string {
  if (leftover.kind === 'unreadable') return translator.t('home.scoring.unreadable');
  if (leftover.kind === 'dead') return translator.tp('home.scoring.deadHere', leftover.unsent);
  if (leftover.kind === 'asked') return translator.tp('scoring.sync.asked', leftover.unsent);
  const label = leftoverLabel(leftover);
  const match = label === '' ? translator.t('home.scoring.matchFallback') : label;
  return translator.tp('home.scoring.elsewhere', leftover.unsent, { match });
}

/** A dead or held queue names its match in a title, its sentence under it; the others are the sentence alone. */
function LeftoverText({ leftover, layout }: { leftover: ScoringLeftover; layout?: CardShape }) {
  const translator = useT();
  const label = leftoverLabel(leftover);
  return (
    <CardText layout={layout}>
      {(leftover.kind === 'dead' || leftover.kind === 'asked') && label !== '' ? (
        <Text variant="state" style={styles.title}>
          {label}
        </Text>
      ) : null}
      <Text variant="control" style={leftover.kind === 'live' ? styles.line : styles.failing}>
        {leftoverSentence(leftover, translator)}
      </Text>
    </CardText>
  );
}

/**
 * Another match's taps. Still sending: counted, with nothing to do. Dead, unreadable or held for the scorer's answer:
 * told, with Dismiss (a held queue sends nothing by itself, and only its own pad takes the answer).
 */
export const ScoringLeftoverCard = memo(function ScoringLeftoverCard(props: LeftoverProps) {
  const { leftover, layout } = props;
  const failing = leftover.kind !== 'live';
  return (
    <CardFrame testID="scoring-leftover" layout={layout} edge={failing ? 'failing' : 'quiet'}>
      <LeftoverText leftover={leftover} layout={layout} />
      {failing ? (
        <DismissButton
          fixtureId={leftover.fixtureId}
          label={leftoverLabel(leftover)}
          onDismiss={props.onDismiss}
        />
      ) : null}
    </CardFrame>
  );
});

/**
 * The taps Exit left sending (S4 design §4, owner 2026-11-07): "Sending 3 taps · Court 2", a quiet card with nothing to
 * press, since the sender is already at work and a Dismiss would throw taps away. Gone once the queue is empty.
 */
export const SendingCard = memo(function SendingCard(props: {
  sending: Sending;
  layout?: CardShape;
}) {
  const { tp, t } = useT();
  const { sending, layout } = props;
  const name = sending.name ?? t('home.scoring.matchFallback');
  return (
    <CardFrame testID="matchday-sending" layout={layout} edge="quiet">
      <CardText layout={layout}>
        <Text variant="control" style={styles.line}>
          {tp('matchday.sendingCard', sending.unsent, { name })}
        </Text>
      </CardText>
    </CardFrame>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    backgroundColor: colour.surface,
  },
  saved: { borderColor: colour.lime },
  quiet: { borderColor: colour.ink3 },
  failingEdge: { borderColor: colour.caution },
  text: { gap: space.xs },
  // The `state` and `control` roles set no colour, and the platform default is black, which is invisible on `surface`.
  title: { color: colour.ink },
  line: { color: colour.ink },
  failing: { color: colour.caution },
  // A finished match's title: the LED lime on night, as the elapsed clock and the scoring pad's digits are.
  final: { color: colour.lime },
  pressed: { backgroundColor: colour.pressFill },
  // Wraps: the 200 dp plate and a second button are wider than the card at 320 dp, and in nl/es at 360 (scoringHomeFit).
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
});

const EDGE: Readonly<Record<Edge, object>> = {
  saved: styles.saved,
  quiet: styles.quiet,
  failing: styles.failingEdge,
};

const rowStyles = StyleSheet.create({
  card: {
    ...rowCardPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    backgroundColor: colour.surface,
  },
  // The words take what the buttons leave and wrap inside it, never behind them.
  text: { flex: 1, minWidth: 0, gap: space.xs },
});

// A press target is never shorter than a `touch`, a one-line title included; the words sit in the middle of it.
const body = StyleSheet.create({
  stacked: { minHeight: sizes.touch, justifyContent: 'center', gap: space.xs },
  row: { flex: 1, minWidth: 0, minHeight: sizes.touch, justifyContent: 'center', gap: space.xs },
});
const stackedIdle = body.stacked;
const rowIdle = body.row;
const stackedPressed = [body.stacked, styles.pressed];
const rowPressed = [body.row, styles.pressed];
