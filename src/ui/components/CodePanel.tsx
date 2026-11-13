import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CodeError } from '@/domain/credentials/waitingFields';
import type { Mode, ModeCode } from '@/domain/mode/Mode';
import type { HomePanel, PanelUnpairReason } from '@/hooks/useHome';
import { useFormatDay, useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { SlideUpSheet } from '@/ui/components/SlideUpSheet';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

type Copy = {
  readonly title: string;
  readonly body: string | null;
  readonly open: string | null;
  /** Try again: only when there was no connection (D27). */
  readonly retry: boolean;
  /** False only while checking: neither the dim nor Back closes it. */
  readonly closable: boolean;
  /** Scan again from the same tile: every settled panel, never while checking or on A7's sheet. */
  readonly scanAgain: boolean;
  /** A7's sheet only: the button that keeps the pairing. The dim means it too, under its name. */
  readonly cancel: string | null;
  /** A dead scoring link with unsent taps stuck on it: lets the match go (design §4.3). */
  readonly dismiss: string | null;
  /** The dismiss question's plate: Keep, first, closing the sheet; the dim and Back mean it too (owner ruling B). */
  readonly keep: string | null;
  /** The dismiss question's Dismiss: deletes the match it names. */
  readonly confirmDismiss: string | null;
  /** The not-yet-open sheet's one button: forgets the code (owner, 2026-11-12). */
  readonly close: string | null;
};

/** A panel that has said its piece: Scan again, and the dim closes it. */
const settled = (title: string, body: string | null, open: string | null = null): Copy => ({
  title,
  body,
  open,
  retry: false,
  closable: true,
  scanAgain: true,
  cancel: null,
  dismiss: null,
  keep: null,
  confirmDismiss: null,
  close: null,
});

/** Every outcome, in the operator's words (decisions 3 and 10). Never "Invalid code". */
function panelCopy(
  outcome: HomePanel,
  translator: Translator,
  time: string | null,
  opens: { readonly day: string; readonly time: string } | null,
): Copy {
  const { t, tp } = translator;
  switch (outcome.kind) {
    case 'otherMode': {
      const mode = t(MODE_NAME[outcome.code.mode]);
      return settled(
        t('panel.otherMode.title', { mode }),
        null,
        t('panel.otherMode.open', { mode }),
      );
    }
    case 'comingSoon': {
      const mode = t(MODE_NAME[outcome.mode]);
      return settled(t('panel.comingSoon.title', { mode }), t('panel.comingSoon.body', { mode }));
    }
    case 'expired':
      return settled(t('panel.expired.title'), t('panel.expired.body', { time: time ?? '' }));
    case 'newerVersion':
      return settled(t('panel.newerVersion.title'), t('panel.newerVersion.body'));
    case 'seaznPage':
      return settled(t('panel.seaznPage.title'), t('panel.seaznPage.body'));
    case 'foreign':
      return settled(t('panel.foreign.title'), t('panel.foreign.body'));
    case 'checking':
      return {
        title: t(
          outcome.tapped === 'scoring' ? 'home.scoring.checking.title' : 'panel.checking.title',
        ),
        body: null,
        open: null,
        retry: false,
        closable: false,
        scanAgain: false,
        cancel: null,
        dismiss: null,
        keep: null,
        confirmDismiss: null,
        close: null,
      };
    case 'codeError':
      return withDismiss(codeCopy(outcome.error, t, outcome.tapped), outcome.dismiss, t);
    case 'unpaired':
      return settled(t(UNPAIRED[outcome.reason].title), t(UNPAIRED[outcome.reason].body));
    // S4 design §4: one line, "Match Day code withdrawn", then Scan again.
    case 'dayRefused':
      return settled(t(outcome.line), null);
    // Owner, 2026-11-12: one sentence and one button, Close, which forgets the code so the tile can scan.
    case 'dayNotOpen':
      return {
        ...settled(
          opens === null ? t('matchday.notOpenSheet.unknown') : t('matchday.notOpenSheet', opens),
          null,
        ),
        scanAgain: false,
        close: t('panel.close'),
      };
    // A7's sheet has the spec's two answers and no others (review C5 I-3): no
    // Scan again, and the dim (and Back) mean Cancel, which sends nothing.
    case 'unpairConfirm': {
      const mode = t(MODE_NAME[outcome.code.mode]);
      return {
        title: t('sheet.unpair.body', { mode }),
        body: null,
        open: t('sheet.unpair.confirm'),
        retry: false,
        closable: true,
        scanAgain: false,
        cancel: t('sheet.unpair.cancel'),
        dismiss: null,
        keep: null,
        confirmDismiss: null,
        close: null,
      };
    }
    case 'dismissConfirm':
      return dismissCopy(outcome, t, tp);
  }
}

/**
 * Owner ruling B (2026-11-02): the sheet names the match and the number of taps, and says they will not reach Seazn. A
 * queue the phone cannot read has no count and, often, no name: it says "another match", as its card does.
 */
function dismissCopy(
  outcome: Extract<HomePanel, { kind: 'dismissConfirm' }>,
  t: Translator['t'],
  tp: Translator['tp'],
): Copy {
  const match = outcome.label === '' ? t('home.scoring.matchFallback') : outcome.label;
  const body =
    outcome.unsent === null
      ? t('home.scoring.confirm.bodyUnreadable')
      : tp('home.scoring.confirm.body', outcome.unsent);
  return {
    title: t('home.scoring.confirm.title', { match }),
    body,
    open: null,
    retry: false,
    closable: true,
    scanAgain: false,
    cancel: null,
    dismiss: null,
    keep: t('home.scoring.confirm.keep'),
    confirmDismiss: t('home.scoring.dismiss'),
    close: null,
  };
}

/** Amendment §2, Unpaired without asking: why native left the pairing. */
const UNPAIRED: Readonly<Record<PanelUnpairReason, { title: MessageKey; body: MessageKey }>> = {
  'code-ended': { title: 'panel.codeEnded.title', body: 'panel.codeEnded.body' },
  replaced: { title: 'panel.replaced.title', body: 'panel.replaced.body' },
  taken: { title: 'panel.taken.title', body: 'panel.taken.body' },
  permissions: { title: 'panel.permissions.title', body: 'panel.permissions.body' },
};

/**
 * Spec §1's table, with a short title over the spec's sentence (D27). The code
 * answer names no end reason, so an ended code reads as one that does not work
 * (amendment §2: "the two 410 lines go").
 */
function codeCopy(error: CodeError, t: Translator['t'], tapped: Mode): Copy {
  const plain = (title: MessageKey, body: MessageKey): Copy => settled(t(title), t(body));
  switch (error.kind) {
    case 'invalid':
    case 'not-found':
    case 'ended':
      // A scoring link that does not work has its own words: "streaming" is not what it was for (design §6.3).
      return tapped === 'scoring'
        ? plain('scoring.card.linkInvalid.title', 'scoring.card.linkInvalid.body')
        : plain('panel.codeInvalid.title', 'panel.codeInvalid.body');
    case 'offline':
      // A scoring link is checked, not a code: its own words say so (the Batch D review).
      return {
        ...plain(
          'panel.descriptor.offline.title',
          tapped === 'scoring' ? 'home.scoring.offline.body' : 'panel.descriptor.offline.body',
        ),
        retry: true,
      };
    case 'rate-limited':
      return settled(
        t('panel.descriptor.busy.title'),
        t('panel.descriptor.busy.body', { n: error.retryAfterS }),
      );
  }
}

/** A bad-link panel that names a stuck match carries its Dismiss. */
function withDismiss(copy: Copy, fixtureId: string | undefined, t: Translator['t']): Copy {
  return fixtureId === undefined ? copy : { ...copy, dismiss: t('home.scoring.dismiss') };
}

type CodePanelProps = {
  outcome: HomePanel;
  time: string | null;
  onOpen: (code: ModeCode) => void;
  onScanAgain: () => void;
  onClose: () => void;
  onTryAgain: () => void;
  /** A7's sheet: Unpair & open. */
  onConfirmUnpair: () => void;
  /** A7's sheet: Cancel. */
  onCancelUnpair: () => void;
  /** A bad scoring link's Dismiss: asks, as a card's does, before the match whose unsent taps it names is let go. */
  onDismiss: (fixtureId: string) => void;
  /** The dismiss question's Dismiss: the match goes. Keep is `onClose`. */
  onConfirmDismiss: (fixtureId: string) => void;
  /** The not-yet-open sheet's Close: the Match Day code goes. The dim and Back only hide the sheet. */
  onCloseNotOpen: () => void;
};

/**
 * Slides up over a dimmed Home; tapping the dim closes it, except while the
 * code is being checked (D27). The sheet is modal to a screen reader, so
 * focus stays on the panel, not on Home beneath it.
 * Both props are needed: native reads `accessibilityViewIsModal` (RN 0.86's
 * View does not map `aria-modal`), and react-native-web reads `aria-modal`.
 */
export const CodePanel = memo(function CodePanel(props: CodePanelProps) {
  const translator = useT();
  const { t } = translator;
  const { outcome, onOpen, onConfirmUnpair, onDismiss, onConfirmDismiss } = props;
  const formatDay = useFormatDay();
  const formatTime = useFormatTime();
  const at = outcome.kind === 'dayNotOpen' ? outcome.at : null;
  const copy = panelCopy(
    outcome,
    translator,
    props.time,
    at === null ? null : { day: formatDay(at, null), time: formatTime(at, null) },
  );
  const open = useCallback(() => {
    if (outcome.kind === 'otherMode') onOpen(outcome.code);
    if (outcome.kind === 'unpairConfirm') onConfirmUnpair();
  }, [outcome, onOpen, onConfirmUnpair]);
  const dismiss = useCallback(() => {
    if (outcome.kind === 'codeError' && outcome.dismiss !== undefined) onDismiss(outcome.dismiss);
    if (outcome.kind === 'dismissConfirm') onConfirmDismiss(outcome.fixtureId);
  }, [outcome, onDismiss, onConfirmDismiss]);
  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          copy.cancel ??
          t(outcome.kind === 'dayNotOpen' ? 'matchday.notOpenSheet.hide' : 'panel.close')
        }
        onPress={copy.cancel === null ? props.onClose : props.onCancelUnpair}
        disabled={!copy.closable}
        style={styles.dim}
      />
      <SlideUpSheet accessibilityViewIsModal aria-modal style={styles.sheet}>
        <Text variant="metricUnit">
          {t('panel.opened', { mode: t(MODE_NAME[outcome.tapped]) })}
        </Text>
        <Text variant="title">{copy.title}</Text>
        {copy.body === null ? null : <Text variant="body">{copy.body}</Text>}
        {copy.open === null ? null : <Button label={copy.open} onPress={open} />}
        {copy.close === null ? null : <Button label={copy.close} onPress={props.onCloseNotOpen} />}
        {copy.keep === null ? null : <Button label={copy.keep} onPress={props.onClose} />}
        {copy.cancel === null ? null : (
          <GhostButton label={copy.cancel} onPress={props.onCancelUnpair} />
        )}
        {copy.retry ? <Button label={t('panel.tryAgain')} onPress={props.onTryAgain} /> : null}
        {copy.scanAgain ? (
          <GhostButton label={t('panel.scanAgain')} onPress={props.onScanAgain} />
        ) : null}
        {copy.dismiss === null ? null : <GhostButton label={copy.dismiss} onPress={dismiss} />}
        {copy.confirmDismiss === null ? null : (
          <GhostButton label={copy.confirmDismiss} onPress={dismiss} />
        )}
      </SlideUpSheet>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: colour.ground, opacity: 0.7 },
  sheet: {
    gap: space.sm,
    padding: space.md,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colour.surface2,
  },
});
