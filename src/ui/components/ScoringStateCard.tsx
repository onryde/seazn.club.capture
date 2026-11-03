import { memo, useCallback } from 'react';
import type { PadTool, PadToolKind } from '@/domain/scoring/padView';
import type { ScoringState } from '@/hooks/padScreenModel';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { EdgeCard, type Edge } from '@/ui/components/EdgeCard';
import { Text } from '@/ui/components/Text';
import { ToolRow } from '@/ui/components/ToolRow';

/** What a button of the card does: the three ways out a state can have. */
type ToolId = 'update' | 'browser' | 'dismiss';

const tool = (id: ToolId, label: MessageKey, kind: PadToolKind): PadTool<MessageKey> => ({
  id,
  label: { key: label },
  detail: null,
  kind,
  enabled: true,
});

const UPDATE = tool('update', 'scoring.card.updateNeeded.update', 'primary');
const BROWSER = tool('browser', 'scoring.card.updateNeeded.browser', 'primary');
const BROWSER_BESIDE_UPDATE = tool('browser', 'scoring.card.updateNeeded.browser', 'standard');
const DISMISS = tool('dismiss', 'home.scoring.dismiss', 'standard');

type Entry = {
  readonly edge: Edge;
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly tools: readonly PadTool<MessageKey>[];
};

const NO_TOOLS: readonly PadTool<MessageKey>[] = [];
const ONLY_BROWSER = [BROWSER];
const ONLY_DISMISS = [DISMISS];
const UPDATE_OR_BROWSER = [UPDATE, BROWSER_BESIDE_UPDATE];

const caution = (title: MessageKey, body: MessageKey, tools = NO_TOOLS): Entry => ({
  edge: 'caution',
  title,
  body,
  tools,
});

/** An unfoldable match: who is to be told or what is to be done depends on why the engine would not take it. */
function unfoldable(reason: 'sides' | 'cfg' | 'ledger'): Entry {
  switch (reason) {
    case 'sides':
      return caution('scoring.state.sides.title', 'scoring.state.sides.body');
    case 'cfg':
      return caution('scoring.state.cfg.title', 'scoring.state.cfg.body', ONLY_BROWSER);
    case 'ledger':
      return caution('scoring.state.ledger.title', 'scoring.state.ledger.body', ONLY_BROWSER);
  }
}

const LOADING: Entry = {
  edge: 'quiet',
  title: 'scoring.state.loading.title',
  body: 'scoring.state.loading.body',
  tools: NO_TOOLS,
};

/**
 * Each state's colour, words and buttons (design §4 step 3, §8). Lilac when there is only waiting to do; caution orange
 * for everything that needs a person (a failure reads orange, never red, AGENTS §5). Only the states a person can act on
 * carry a button: Update and the browser for an app too old or a sport it cannot score, Dismiss for what can never be
 * opened again; the way Home is always the top bar's Back.
 */
function entryOf(state: ScoringState): Entry {
  switch (state.kind) {
    case 'loading':
      return state.offline
        ? caution('scoring.state.offline.title', 'scoring.state.offline.body')
        : LOADING;
    case 'linkGone':
      return caution('scoring.state.linkGone.title', 'scoring.state.linkGone.body', ONLY_DISMISS);
    case 'unreadable':
      return state.what === 'queue'
        ? caution(
            'scoring.state.unreadableQueue.title',
            'scoring.state.unreadableQueue.body',
            ONLY_DISMISS,
          )
        : caution('scoring.state.unreadableLink.title', 'scoring.state.unreadableLink.body');
    case 'unsupportedSport':
      return caution(
        'scoring.state.unsupported.title',
        'scoring.state.unsupported.body',
        ONLY_BROWSER,
      );
    case 'tooLarge':
      return caution('scoring.state.tooLarge.title', 'scoring.state.tooLarge.body', ONLY_BROWSER);
    case 'unfoldable':
      return unfoldable(state.reason);
    case 'outdated':
      return caution(
        'scoring.state.outdated.title',
        'scoring.card.updateNeeded.body',
        UPDATE_OR_BROWSER,
      );
  }
}

type ScoringStateCardProps = {
  readonly state: ScoringState;
  /** What a button said when it could not do its job (a store or a browser that would not open); null otherwise. */
  readonly note: string | null;
  readonly onUpdate: () => void;
  readonly onBrowser: () => void;
  readonly onDismiss: () => void;
};

/**
 * A scoring match that is not a pad (plan S2-1 Task 11): the card that stands in the pad's place and says why, for any
 * sport. It is the pad's own state card (`EdgeCard`) with a title, the sentence, what else the operator needs to know
 * (the sport the build does not score, the taps an update leaves unsent), and the pad's own tool buttons for the way out.
 */
export const ScoringStateCard = memo(function ScoringStateCard({
  state,
  note,
  onUpdate,
  onBrowser,
  onDismiss,
}: ScoringStateCardProps) {
  const { t } = useT();
  const entry = entryOf(state);
  const press = useCallback(
    (id: string) => {
      if (id === 'update') onUpdate();
      else if (id === 'browser') onBrowser();
      else onDismiss();
    },
    [onUpdate, onBrowser, onDismiss],
  );
  return (
    <EdgeCard testID="scoring-state-card" edge={entry.edge}>
      <Text variant="panelTitle" accessibilityRole="header">
        {t(entry.title)}
      </Text>
      <Text variant="body">{t(entry.body)}</Text>
      <Aside state={state} />
      {entry.tools.length === 0 ? null : (
        <ToolRow testID="scoring-state-tools" tools={entry.tools} onTool={press} />
      )}
      {note === null ? null : <Text variant="control">{note}</Text>}
    </EdgeCard>
  );
});

/** The one line a state adds under its sentence: the sport, or the taps an update leaves unsent. */
function Aside({ state }: { readonly state: ScoringState }) {
  const { t, tp } = useT();
  if (state.kind === 'unsupportedSport') {
    return (
      <Text variant="metricUnit">
        {t('scoring.state.unsupported.sport', { sport: state.sportKey })}
      </Text>
    );
  }
  if (state.kind === 'outdated' && state.unsent > 0) {
    return <Text variant="control">{tp('scoring.card.updateNeeded.unsent', state.unsent)}</Text>;
  }
  return null;
}
