import { memo } from 'react';
import { useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { useRecordSend } from '@/hooks/useRecordSend';
import type { PowerMode } from '@/services/devicePorts';
import { MODE_WORD } from '@/ui/components/PowerRow';
import { sendLabel, sendReason } from '@/ui/components/RecordRow';
import { SettingsRow } from '@/ui/components/SettingsRow';

/**
 * Battery as one row of the app's Settings (R5, N27; the owner's rows, 2026-11-02): the mode in Android's own word at the
 * right, the row itself the way to App info. The words that used to print under it are gone: it says one line only where
 * the operator has something to do, the path to Unrestricted when the mode is not it (the mode that lets a locked phone
 * keep beating), and from Arming on that the row is off, in three words ("After the broadcast", which beside the mode's
 * word fits one line at 320 dp), because App info is one tap from Force stop (AGENTS §6). The
 * screen reads the mode (`usePowerState`) and draws this only where it is known (Android), so an absent row leaves no line.
 */
export const BatteryRow = memo(function BatteryRow({
  mode,
  held,
  open,
}: {
  mode: PowerMode;
  held: boolean;
  open: () => void;
}) {
  const { t } = useT();
  const helper = held
    ? t('settings.battery.onAir')
    : mode === 'unrestricted'
      ? null
      : t('settings.power.path');
  return (
    <SettingsRow
      label={t('settings.battery.label')}
      value={t(MODE_WORD[mode])}
      tone={mode === 'unrestricted' ? 'normal' : 'caution'}
      helper={helper}
      onPress={open}
      disabled={held}
    />
  );
});

/** Share record (N33): outside the Diagnostics card, so a phone sent Home by Replaced can still hand its record over. */
export const ShareRecordRow = memo(function ShareRecordRow() {
  const { t } = useT();
  const { share, shareFailed } = useSessionRecord();
  return <SettingsRow label={t(shareFailed ? 'diag.shareFailed' : 'diag.share')} onPress={share} />;
});

/**
 * Send record to Seazn (R3): off while a send is out, until the credential is known, with none, and while a broadcast is
 * held (Minor 8 of the Batch 6 review). One line says why, on air first; nothing is said before the first read answers.
 * Its words in each state are the record row's (`sendLabel`, `sendReason`).
 */
export const SendRecordRow = memo(function SendRecordRow() {
  const { t } = useT();
  const { state, available, held, send } = useRecordSend();
  const reason = sendReason(state, held, available);
  return (
    <SettingsRow
      label={sendLabel(state, t)}
      helper={reason === null ? null : t(reason)}
      onPress={send}
      disabled={held || available !== true || state.kind === 'sending'}
    />
  );
});
