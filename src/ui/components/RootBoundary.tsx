import { useCallback, useMemo, type ReactNode } from 'react';
import type { Ports } from '@/hooks/usePorts';
import { pickLanguage } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

/**
 * The root's error boundary (final review M4). A render crash outside the
 * overlay's own boundary takes the whole shell down, LIVE plate and Stop with
 * it, while native goes on publishing (AGENTS §2). So the crash is recorded,
 * the copy says the broadcast may still be live, and Try again remounts the
 * shell, whose reopen gate lands on the viewfinder again while on air.
 *
 * The ports live outside this boundary and outlive the remount, but Expo
 * Router's root Stack does not: it starts again at Home. So Try again tells the
 * navigation port first (final fix round 2, I-A); otherwise the gate's
 * `go('stream')` would see a cached `stream` and do nothing.
 *
 * It sits outside the language provider, which may be what crashed, so it
 * reads in the phone's language, not the operator's pick.
 */
export function RootBoundary({ ports, children }: { ports: Ports; children: ReactNode }) {
  const { t } = useMemo(
    () => createTranslator(pickLanguage(null, ports.deviceLanguages)),
    [ports.deviceLanguages],
  );
  // The splash first (R15); the message never reaches the record: it may carry anything.
  const onCatch = useCallback(() => {
    ports.splash.hide();
    ports.logger.error('ui.crash');
  }, [ports]);
  const onRetry = useCallback(() => ports.navigation.restart(), [ports]);
  return (
    <ErrorBoundary
      onRetry={onRetry}
      label={t('crash.heading')}
      note={t('crash.mayBeLive')}
      retryLabel={t('panel.tryAgain')}
      onCatch={onCatch}
    >
      {children}
    </ErrorBoundary>
  );
}
