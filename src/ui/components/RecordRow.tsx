import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { useRecordSend, type SendFailure, type SendState } from '@/hooks/useRecordSend';
import type { MessageKey } from '@/i18n/messages';
import type { Translator } from '@/i18n/translate';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * N33, R3 of the D3 findings design (owner, 2026-10-11): the record row, in both Stream Settings variants. Share
 * record moved here out of the Diagnostics card, so a phone sent Home by Replaced can still hand its record over;
 * with its switch on (`FEATURES.recordSend`), Send record to Seazn follows it. Stacked, so each label has the column's
 * width (the D3 fixes plan's ruling P11, the controller's). A failure says so on its own button, as Share's does.
 */
export const RecordRow = memo(function RecordRow({ send }: { send: boolean }) {
  const { t } = useT();
  const { share, shareFailed } = useSessionRecord();
  return (
    <View testID="record-row" style={styles.row}>
      <GhostButton
        label={t(shareFailed ? 'diag.shareFailed' : 'diag.share')}
        onPress={share}
        compact
      />
      {send ? <SendRecord /> : null}
    </View>
  );
});

/**
 * Send record to Seazn: disabled while a send is in flight, until the credential is known, with none, and while a
 * broadcast is held (Minor 8 of the Batch 6 review, the controller's ruling: as the battery row's App settings). One
 * line says why, on air first; nothing is said before the first read answers (Minor 7).
 */
const SendRecord = memo(function SendRecord() {
  const { t } = useT();
  const { state, available, held, send } = useRecordSend();
  const reason = held ? 'record.onAir' : available === false ? 'record.needsCode' : whyNot(state);
  return (
    <>
      <GhostButton
        label={sendLabel(state, t)}
        onPress={send}
        compact
        disabled={held || available !== true || state.kind === 'sending'}
      />
      {reason === null ? null : <Text variant="metricUnit">{t(reason)}</Text>}
    </>
  );
});

/** The button's words in each state (spec §7); the ref is the server's, for the operator to read out. */
function sendLabel(state: SendState, t: Translator['t']): string {
  switch (state.kind) {
    case 'idle':
      return t('record.send');
    case 'sending':
      return t('record.sending');
    case 'sent':
      return t('record.sent', { ref: state.ref });
    case 'failed':
      return t(state.why === 'retry' ? 'record.sendFailed' : 'record.cantSend');
  }
}

/** Why a send cannot go, under a failure another try cannot change (fix round 1 of Batch 11, ruling 8); else none. */
const CANT: Readonly<Record<Exclude<SendFailure, 'retry'>, MessageKey>> = {
  ended: 'record.cant.ended',
  'not-found': 'record.cant.notFound',
  'too-large': 'record.cant.tooLarge',
  mismatch: 'record.cant.mismatch',
};

function whyNot(state: SendState): MessageKey | null {
  return state.kind === 'failed' && state.why !== 'retry' ? CANT[state.why] : null;
}

const styles = StyleSheet.create({
  /** A column whose buttons hug their box at its start, as the battery row's does; never a full-width target. */
  row: { gap: space.xs, alignItems: 'flex-start' },
});
