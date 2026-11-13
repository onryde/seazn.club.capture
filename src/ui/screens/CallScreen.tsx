import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Candidate, Warning } from '@/domain/matchday/callWire';
import type { Line } from '@/domain/matchday/callCopy';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useCallCourt, type CallSink, type CallView } from '@/hooks/useCallCourt';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { useRowWords } from '@/hooks/useRowWords';
import type { MessageKey } from '@/i18n/messages';
import { Button } from '@/ui/components/Button';
import { CandidateRow } from '@/ui/components/CandidateRow';
import { GhostButton } from '@/ui/components/GhostButton';
import { HoldAction } from '@/ui/components/HoldAction';
import { MatchRow } from '@/ui/components/MatchRow';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type CallScreenProps = {
  readonly courtId: string;
  readonly court: string;
  /** The court is still free on the latest read of the day: when it stops being, the sheet says so and offers Close. */
  readonly free: boolean;
  /** The venue's zone, for the planned times. */
  readonly zone: string;
  /** Reads the day again (the list's own read), after a call or a refusal that changes it. */
  readonly refresh: () => void;
  readonly onClose: () => void;
};

/**
 * Call a match to a free court (S4 design §7a), over the list in the approval's overlay style: "Call to {court}", the
 * desk's candidates for it, then the preview of the one picked and a 3 s hold to call it (`useHold`, `HoldFill`,
 * as approvals). A candidate whose player is elsewhere is dimmed and not a control. When the list's next read says the
 * court is no longer free the sheet says so and offers Close. Android Back closes it, cancelling a hold in progress.
 */
export const CallScreen = memo(function CallScreen({
  courtId,
  court,
  free,
  zone,
  refresh,
  onClose,
}: CallScreenProps) {
  const { t } = useT();
  const sink: CallSink = { refresh, close: onClose };
  const view = useCallCourt(courtId, court, sink);
  useBackCloses(true, onClose);
  const title = t('matchday.call.title', { court });
  const gone = !free && !view.calling;
  return (
    <View
      testID="call-screen"
      aria-modal
      accessibilityViewIsModal
      accessibilityLabel={title}
      style={styles.screen}
    >
      <View style={styles.bar}>
        <SubScreenHeader
          title={title}
          onBack={onClose}
          plate={false}
          backLabel={t('mode.matchday')}
        />
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.column}>
        {gone ? <NoLongerFree court={court} /> : <Body view={view} court={court} zone={zone} />}
      </ScrollView>
      <View style={styles.footer}>
        {gone ? (
          <Button label={t('matchday.call.close')} onPress={onClose} />
        ) : (
          <Footer view={view} onClose={onClose} />
        )}
      </View>
    </View>
  );
});

const NoLongerFree = memo(function NoLongerFree({ court }: { readonly court: string }) {
  const { t } = useT();
  return (
    <Text variant="controlInk" testID="call-not-free">
      {t('matchday.call.notFree', { court })}
    </Text>
  );
});

const Notice = memo(function Notice({ line }: { readonly line: Line }) {
  const { t } = useT();
  return (
    <Text variant="control" testID="call-line" style={styles.line}>
      {t(line.key as MessageKey, line.vars)}
    </Text>
  );
});

const Body = memo(function Body({
  view,
  court,
  zone,
}: {
  readonly view: CallView;
  readonly court: string;
  readonly zone: string;
}) {
  return (
    <>
      {view.notice === null ? null : <Notice line={view.notice} />}
      {view.step === 'preview' && view.picked !== null ? (
        <Preview view={view} picked={view.picked} zone={zone} />
      ) : (
        <Candidates view={view} court={court} zone={zone} />
      )}
    </>
  );
});

const Candidates = memo(function Candidates({
  view,
  court,
  zone,
}: {
  readonly view: CallView;
  readonly court: string;
  readonly zone: string;
}) {
  const { t } = useT();
  if (view.list === 'loading') return <Text variant="body">{t('matchday.call.loading')}</Text>;
  if (view.list === 'offline') return <Text variant="body">{t('matchday.offlineEmpty')}</Text>;
  if (view.list === 'refused') return null;
  if (view.candidates.length === 0) return <Text variant="body">{t('matchday.call.none')}</Text>;
  return (
    <View style={styles.rows}>
      {view.candidates.map((candidate) => (
        <CandidateRow
          key={candidate.match.fixtureId}
          candidate={candidate}
          court={court}
          zone={zone}
          onPick={view.pick}
        />
      ))}
    </View>
  );
});

/** The match picked, and what calling it does to the day: one line a warning, or "No knock-on". */
const Preview = memo(function Preview({
  view,
  picked,
  zone,
}: {
  readonly view: CallView;
  readonly picked: Candidate;
  readonly zone: string;
}) {
  const { t } = useT();
  const words = useRowWords(zone)(picked.match);
  return (
    <>
      <View style={styles.rows}>
        <MatchRow chip={words.chip} names={words.names} parts={words.parts} detail={null} />
      </View>
      {view.preview === 'loading' ? (
        <Text variant="body">{t('matchday.call.checking')}</Text>
      ) : null}
      {view.preview === 'offline' ? <Text variant="body">{t('matchday.offlineEmpty')}</Text> : null}
      {view.preview === 'ready' ? <Warnings warnings={view.warnings} /> : null}
    </>
  );
});

const Warnings = memo(function Warnings({ warnings }: { readonly warnings: readonly Warning[] }) {
  const { t } = useT();
  if (warnings.length === 0)
    return (
      <Text variant="controlInk" testID="call-quiet">
        {t('matchday.call.quiet')}
      </Text>
    );
  return (
    <View style={styles.warnings}>
      {warnings.map((warning, at) => (
        <WarningLine key={`${warning.kind}-${at}`} warning={warning} />
      ))}
    </View>
  );
});

const WarningLine = memo(function WarningLine({ warning }: { readonly warning: Warning }) {
  const { t, tp } = useT();
  const text = warningWords(warning, t, tp);
  return (
    <Text variant="control" testID="call-warning" style={styles.warning}>
      {text}
    </Text>
  );
});

function warningWords(
  warning: Warning,
  t: ReturnType<typeof useT>['t'],
  tp: ReturnType<typeof useT>['tp'],
): string {
  switch (warning.kind) {
    case 'pushesLater':
      return tp('matchday.call.pushes', warning.count);
    case 'pastDayEnd':
      return t('matchday.call.pastEnd');
    case 'crossesClosure':
      return t('matchday.call.closure');
    case 'restGap':
      return t('matchday.call.rest', { name: warning.personName });
    case 'courtClosed':
      return t('matchday.call.closed', { court: warning.courtName });
  }
}

/** The hold (a ready preview), Try again (offline), or the way back to the list; nothing while a read is out. */
const Footer = memo(function Footer({
  view,
  onClose,
}: {
  readonly view: CallView;
  readonly onClose: () => void;
}) {
  const { t } = useT();
  if (view.step === 'list') {
    if (view.list === 'offline')
      return <GhostButton label={t('panel.tryAgain')} onPress={view.retry} />;
    if (view.list === 'refused')
      return <Button label={t('matchday.call.close')} onPress={onClose} />;
    return null;
  }
  if (view.preview === 'offline')
    return (
      <>
        <GhostButton label={t('panel.tryAgain')} onPress={view.retryPreview} />
        <GhostButton label={t('matchday.call.other')} onPress={view.choose} />
      </>
    );
  const ready = view.preview === 'ready';
  return (
    <>
      <HoldAction
        label={t('matchday.call.hold')}
        a11yLabel={t('stream.action.holdLabel', { label: t('matchday.call.action') })}
        tone="go"
        disabled={!ready || view.calling}
        reason={view.calling ? t('matchday.call.calling') : null}
        onHeld={view.call}
      />
      <GhostButton label={t('matchday.call.other')} onPress={view.choose} disabled={view.calling} />
    </>
  );
});

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colour.ground,
  },
  bar: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  body: { flex: 1 },
  column: { gap: space.md, paddingHorizontal: space.md, paddingBottom: space.md },
  line: { color: colour.caution },
  rows: {
    paddingHorizontal: layout.matchDayCardPad,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
  warnings: { gap: space.xs },
  warning: { color: colour.caution },
  footer: { gap: space.sm, padding: space.md },
});
