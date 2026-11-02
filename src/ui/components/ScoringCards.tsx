import { memo, useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScoringCurrent, ScoringLeftover } from '@/domain/mode/scoringHome';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { rowCardPadding, type CardShape } from '@/ui/components/cardShape';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * Home's Remote Scoring cards (plan S2-1 Task 10; design §5, §6.3, ruling 29). What each says is `scoringHome`'s
 * decision; the words are here, in the order the operator needs them: which match, what is unsent, what to do. A live
 * queue is only counted, because it is still sending; a queue that can never send, or cannot be read, is told to the
 * organiser, in orange (a failure reads orange, never red). Its Dismiss asks first (owner ruling B, 2026-11-02), and
 * each card's button carries its match in its name, so two cards never both read just "Dismiss".
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

/** The buttons: they wrap under each other where the card is too narrow for both (`scoringHomeFit`). */
function CardActions(props: { children: ReactNode }) {
  return (
    <View testID="scoring-actions" style={styles.actions}>
      {props.children}
    </View>
  );
}

/** A screen reader's name for a card's Dismiss: its match, or "another match" for a queue that never learned one. */
function dismissName(label: string, translator: Translator): string {
  const match = label === '' ? translator.t('home.scoring.matchFallback') : label;
  return translator.t('home.scoring.dismissMatch', { match });
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
      accessibilityLabel={dismissName(props.label, translator)}
      onPress={press}
    />
  );
}

/** The sentence under a match's name: what is unsent and what that means; null when there is nothing to say. */
function currentSentence(current: ScoringCurrent, t: Translator): string | null {
  if (current.state === 'unreadable') return t.t('home.scoring.unreadable');
  if (current.unsent === 0) return null;
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
 * on a live queue would discard taps that are about to be sent (ruling 29).
 */
function CurrentActions(props: Omit<ContinueProps, 'layout'>) {
  const translator = useT();
  const { current, onForget } = props;
  const forget = useCallback(() => onForget(current.fixtureId), [onForget, current.fixtureId]);
  return (
    <CardActions>
      <Button label={translator.t('home.continue.open')} onPress={props.onContinue} />
      {current.state !== 'live' ? (
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

/** The saved match: Continue opens the pad; the second button lets the match go when it holds nothing that can send. */
export const ScoringContinueCard = memo(function ScoringContinueCard(props: ContinueProps) {
  const { current, layout } = props;
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
  const label = leftoverLabel(leftover);
  const match = label === '' ? translator.t('home.scoring.matchFallback') : label;
  return translator.tp('home.scoring.elsewhere', leftover.unsent, { match });
}

/** A dead queue names its match in a title, its sentence under it; the others are the sentence alone. */
function LeftoverText({ leftover, layout }: { leftover: ScoringLeftover; layout?: CardShape }) {
  const translator = useT();
  const label = leftoverLabel(leftover);
  return (
    <CardText layout={layout}>
      {leftover.kind === 'dead' && label !== '' ? (
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

/** Another match's taps. Still sending: counted, with nothing to do. Dead or unreadable: told, with Dismiss. */
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
