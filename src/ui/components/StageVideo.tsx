import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { peekPlaybackUrl } from '@/domain/session/previewUrls';
import { usePorts } from '@/hooks/usePorts';

type StageVideoProps = {
  /** The descriptor's playback URL; the peek's bandwidth hint is added here. */
  readonly url: string;
  readonly showing: boolean;
};

/**
 * The delivered picture over the stage while the peek is held; invisible but
 * still loaded while it cools, so a second peek is instant. Muted, fetched
 * live, never cached (D37) — the Video surface owns all three. It never takes
 * a touch: the finger holding the peek stays on the control.
 */
export const StageVideo = memo(function StageVideo({ url, showing }: StageVideoProps) {
  const { surfaces } = usePorts();
  const { Video } = surfaces;
  return (
    <View
      pointerEvents="none"
      style={showing ? styles.shown : styles.hidden}
      aria-hidden={!showing}
    >
      <Video url={peekPlaybackUrl(url)} playing={showing} />
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({
  shown: { ...StyleSheet.absoluteFill },
  hidden: { ...StyleSheet.absoluteFill, opacity: 0 },
});
