import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { selectSinceEpochMs } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import { formatElapsed } from '@/ui/format';
import { status } from '@/ui/theme/tokens';

/**
 * Holds its own second-hand so that a ticking clock re-renders this component
 * and nothing else. Engine telemetry arrives at ~1 Hz but the clock must
 * advance regardless of whether any measurement changed.
 */
export function Elapsed({ dimmed = false }: { dimmed?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const since = useEngineSelector(selectSinceEpochMs);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = since === null ? 0 : Math.max(0, now - since);

  // Dimmed rather than hidden while the snapshot is stale: the number is
  // probably still right and the eye anchors on it, so the colour carries the
  // honesty instead of removing the anchor.
  // One line, always. `H:MM:SS` past the hour is roughly 115-122px of Barlow
  // Condensed at 38px against 114px of column, so without this the clock
  // wraps or clips for the second and third hour of every match. Shrinking to
  // fit is the right failure: a smaller clock still reads, a clipped one lies.
  return (
    <Text
      variant="elapsed"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
      style={dimmed ? styles.dimmed : undefined}
    >
      {formatElapsed(elapsedMs)}
    </Text>
  );
}

const styles = StyleSheet.create({
  dimmed: {
    color: status.inert,
  },
});
