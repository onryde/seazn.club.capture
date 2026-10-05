import { memo, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Dev only: a preview crash on demand, as a native preview crash would reach the boundary. It throws
 * on every render while armed (PV41): React 19 renders the root again, synchronously, after an error,
 * so a throw on one render alone would never reach the boundary. Show preview disarms it.
 */
const devCrash = { armed: false, listeners: new Set<() => void>() };

/** Dev only: the preview throws until Show preview is pressed (PV41). */
export function crashPreviewUntilShown(): void {
  devCrash.armed = true;
  devCrash.listeners.forEach((listener) => listener());
}

function DevCrash(): null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    devCrash.listeners.add(bump);
    return () => {
      devCrash.listeners.delete(bump);
    };
  }, []);
  if (devCrash.armed) throw new Error('dev preview crash');
  return null;
}

/**
 * The viewfinder's own boundary (owner ruling 2, CD19): a preview crash leaves the column, its
 * plate and the Stop hold standing. The key is on the boundary itself (I4): it keeps its fallback
 * while it holds an error, so Show preview mounts a new one.
 */
export const PreviewBoundary = memo(function PreviewBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useT();
  const { logger, devTools } = usePorts();
  const [generation, setGeneration] = useState(0);
  const crashes = useRef(0);
  const onCatch = useCallback(() => {
    crashes.current += 1;
    logger.warn('preview.crashed', { count: crashes.current });
  }, [logger]);
  const show = useCallback(() => {
    devCrash.armed = false;
    setGeneration((n) => n + 1);
  }, []);
  const fallback = (
    <View style={styles.fallback}>
      <Text variant="status" style={styles.caption}>
        {t('stream.preview.stopped')}
      </Text>
      <GhostButton label={t('stream.preview.show')} onPress={show} />
    </View>
  );
  return (
    <ErrorBoundary key={generation} label="preview" onCatch={onCatch} fallback={fallback}>
      {children}
      {devTools ? <DevCrash /> : null}
    </ErrorBoundary>
  );
});

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  caption: { color: colour.caution },
});
