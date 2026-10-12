import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { useRecordSend, type SendState } from '@/hooks/useRecordSend';
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

/** Send record to Seazn: disabled while a send is in flight, and with no credential, where one line says why. */
const SendRecord = memo(function SendRecord() {
  const { t } = useT();
  const { state, available, send } = useRecordSend();
  return (
    <>
      <GhostButton
        label={sendLabel(state, t)}
        onPress={send}
        compact
        disabled={!available || state.kind === 'sending'}
      />
      {available ? null : <Text variant="metricUnit">{t('record.needsCode')}</Text>}
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
      return t('record.sendFailed');
  }
}

const styles = StyleSheet.create({
  /** A column whose buttons hug their box at its start, as the battery row's does; never a full-width target. */
  row: { gap: space.xs, alignItems: 'flex-start' },
});
